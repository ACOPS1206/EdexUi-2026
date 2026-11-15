const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {runInNewContext} = require("node:vm");
const {afterEach, describe, it, mock} = require("node:test");

const terminalSource = readFileSync(join(__dirname, "../src/classes/terminal.class.js"), "utf8");
let terminal;

function startTerminal() {
    const ipcMain = new EventEmitter();
    const ptyEvents = new EventEmitter();
    const pty = {
        onData: listener => ptyEvents.on("data", listener),
        onExit: listener => ptyEvents.on("exit", listener),
        write: mock.fn(),
        resize: mock.fn(),
        kill: mock.fn(() => ptyEvents.emit("exit", {exitCode: 0})),
    };
    const renderer = {send: mock.fn(), isDestroyed: () => false};
    const trusted = {sender: renderer, senderFrame: {}};
    const module = {};
    runInNewContext(terminalSource, {
        module, Buffer, Uint8Array, process, setInterval, clearInterval,
        require(name) {
            if (name === "electron") return {ipcMain};
            if (name === "node-pty") return {spawn: () => pty};
            throw new Error(`Unexpected terminal dependency: ${name}`);
        },
    });
    terminal = new module.exports.Terminal({
        role: "server", id: 3, isTrustedSender: event => event === trusted,
        shell: "bash", env: {}, params: [], cwd: "/",
    });
    return {ipcMain, pty, ptyEvents, renderer, trusted};
}

afterEach(() => terminal?.close());

describe("terminal IPC", () => {
    it("accepts input and valid sizes only from the attached trusted renderer", () => {
        const {ipcMain, pty, renderer, trusted} = startTerminal();
        ipcMain.emit("terminal:3", trusted, "Input", "before attach");
        assert.equal(terminal.attach(renderer), true);
        ipcMain.emit("terminal:3", {sender: renderer}, "Input", "forged frame");
        ipcMain.emit("terminal:3", trusted, "Input", {bad: true});
        ipcMain.emit("terminal:3", trusted, "Input", "authorized input");
        ipcMain.emit("terminal:3", trusted, "Input", Uint8Array.of(255));
        ipcMain.emit("terminal:3", trusted, "Resize", 0, 65536);
        ipcMain.emit("terminal:3", trusted, "Resize", 100, 32);

        assert.deepEqual(pty.write.mock.calls.map(call => Array.from(call.arguments)), [["authorized input"], [Buffer.from([255])]]);
        assert.deepEqual(pty.resize.mock.calls.map(call => Array.from(call.arguments)), [[100, 32]]);
    });

    it("preserves shell startup output and stops accepting input after exit", () => {
        const {ipcMain, pty, ptyEvents, renderer, trusted} = startTerminal();
        terminal.onclosed = mock.fn();
        ptyEvents.emit("data", "startup");
        terminal.attach(renderer);
        ptyEvents.emit("data", "running");
        ptyEvents.emit("exit", {exitCode: 9, signal: 0});
        ipcMain.emit("terminal:3", trusted, "Input", "after exit");

        assert.deepEqual(renderer.send.mock.calls.map(call => Array.from(call.arguments)), [
            ["terminal:3", "New cwd", "/"],
            ["terminal:3", "Output", "startup"],
            ["terminal:3", "Output", "running"],
            ["terminal:3", "Closed", undefined],
        ]);
        assert.deepEqual(terminal.onclosed.mock.calls.map(call => Array.from(call.arguments)), [[9, 0]]);
        assert.equal(terminal.attach(renderer), false);
        assert.equal(ipcMain.listenerCount("terminal:3"), 0);
        assert.equal(pty.write.mock.callCount(), 0);
    });
});
