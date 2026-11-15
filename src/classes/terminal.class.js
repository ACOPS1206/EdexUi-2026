class Terminal {
    constructor(opts) {
        const channel = `terminal:${opts.id}`;
        if (opts.role === "client") {
            if (!opts.parentId) throw "Missing options";

            this.xTerm = require("xterm").Terminal;
            const {FitAddon} = require("xterm-addon-fit");
            const {LigaturesAddon} = require("xterm-addon-ligatures");
            const {WebglAddon} = require("xterm-addon-webgl");
            this.Ipc = require("electron").ipcRenderer;

            this.cwd = "";
            this.isReady = false;
            this.oncwdchange = () => {};

            const colorify = base => base;

            this.term = new this.xTerm({
                cols: 80,
                rows: 24,
                rendererType: "canvas",
                cursorBlink: window.theme.terminal.cursorBlink ?? true,
                cursorStyle: window.theme.terminal.cursorStyle || "block",
                allowTransparency: window.theme.terminal.allowTransparency ?? false,
                fontFamily: window.theme.terminal.fontFamily || "Fira Mono",
                fontSize: window.theme.terminal.fontSize || window.settings.termFontSize || 15,
                fontWeight: window.theme.terminal.fontWeight || "normal",
                fontWeightBold: window.theme.terminal.fontWeightBold || "bold",
                letterSpacing: window.theme.terminal.letterSpacing || 0,
                lineHeight: window.theme.terminal.lineHeight || 1,
                scrollback: 1500,
                bellStyle: "none",
                theme: {
                    foreground: window.theme.terminal.foreground,
                    background: window.theme.terminal.background,
                    cursor: window.theme.terminal.cursor,
                    cursorAccent: window.theme.terminal.cursorAccent,
                    selection: window.theme.terminal.selection,
                    black: window.theme.colors.black || colorify("#2e3436"),
                    red: window.theme.colors.red || colorify("#cc0000"),
                    green: window.theme.colors.green || colorify("#4e9a06"),
                    yellow: window.theme.colors.yellow || colorify("#c4a000"),
                    blue: window.theme.colors.blue || colorify("#3465a4"),
                    magenta: window.theme.colors.magenta || colorify("#75507b"),
                    cyan: window.theme.colors.cyan || colorify("#06989a"),
                    white: window.theme.colors.white || colorify("#d3d7cf"),
                    brightBlack: window.theme.colors.brightBlack || colorify("#555753"),
                    brightRed: window.theme.colors.brightRed || colorify("#ef2929"),
                    brightGreen: window.theme.colors.brightGreen || colorify("#8ae234"),
                    brightYellow: window.theme.colors.brightYellow || colorify("#fce94f"),
                    brightBlue: window.theme.colors.brightBlue || colorify("#729fcf"),
                    brightMagenta: window.theme.colors.brightMagenta || colorify("#ad7fa8"),
                    brightCyan: window.theme.colors.brightCyan || colorify("#34e2e2"),
                    brightWhite: window.theme.colors.brightWhite || colorify("#eeeeec")
                }
            });
            this.parent = document.getElementById(opts.parentId);
            let fitAddon = new FitAddon();
            this.fitAddon = fitAddon;
            this.term.loadAddon(fitAddon);
            this.term.open(this.parent);

            this._webglFailed = false;
            this._webglAddon = null;
            this.disableHardwareAcceleration = () => {
                if (this._webglAddon && typeof this._webglAddon.dispose === "function") {
                    this._webglAddon.dispose();
                }
                this._webglAddon = null;
            };
            this.enableHardwareAcceleration = () => {
                if (!window.settings.termHardwareAcceleration || this._webglFailed || this._webglAddon) return;
                const parent = document.getElementById(opts.parentId);
                if (!parent || !parent.classList.contains("active")) return;
                try {
                    this._webglAddon = new WebglAddon();
                    if (typeof this._webglAddon.onContextLoss === "function") {
                        this._webglAddon.onContextLoss(() => {
                            console.warn("WebGL terminal context lost, falling back to canvas renderer");
                            this.disableHardwareAcceleration();
                            this._webglFailed = true;
                        });
                    }
                    this.term.loadAddon(this._webglAddon);
                } catch (error) {
                    this._webglFailed = true;
                    this._webglAddon = null;
                    console.warn("WebGL terminal acceleration disabled:", error);
                }
            };
            if (window.settings.termLigatures) {
                try {
                    let ligaturesAddon = new LigaturesAddon();
                    this.term.loadAddon(ligaturesAddon);
                } catch (error) {
                    console.warn("Terminal ligatures disabled:", error);
                }
            }
            this.term.attachCustomKeyEventHandler(e => {
                window.keyboard.keydownHandler(e);
                return true;
            });
            // Prevent soft-keyboard on touch devices #733
            document.querySelectorAll('.xterm-helper-textarea').forEach(textarea => textarea.setAttribute('readonly', 'readonly'));
            this.focus = () => {
                this.term.focus();
                const textarea = this.parent ? this.parent.querySelector('.xterm-helper-textarea') : null;
                if (textarea && typeof textarea.focus === 'function') {
                    textarea.focus({preventScroll: true});
                }
            };
            this.focus();

            this.resendCWD = () => {
                this.oncwdchange(this.cwd || null);
            };

            this.lastSoundFX = Date.now();
            const writeOutput = data => {
                this.term.write(data);
                let d = Date.now();

                if (d - this.lastSoundFX > 30) {
                    if(window.passwordMode == "false")
                        window.audioManager.stdout.play();
                    this.lastSoundFX = d;
                }
                if (d - this.lastRefit > 10000) {
                    this.fit();
                }

                // See #397
                if (!window.settings.experimentalGlobeFeatures) return;
                let ips = data.match(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);
                if (ips !== null && ips.length >= 1) {
                    ips = ips.filter((val, index, self) => { return self.indexOf(val) === index; });
                    ips.forEach(ip => {
                        window.mods.globe.addTemporaryConnectedMarker(ip);
                    });
                }
            };

            const parentEvents = new AbortController();
            const parentListener = {signal: parentEvents.signal};
            let parent = this.parent;
            parent.addEventListener("wheel", e => {
                this.term.scrollLines(Math.round(e.deltaY/10));
            }, parentListener);
            this._lastTouchY = null;
            parent.addEventListener("touchstart", e => {
                this._lastTouchY = e.targetTouches[0].screenY;
            }, parentListener);
            parent.addEventListener("touchmove", e => {
                if (this._lastTouchY) {
                    let y = e.changedTouches[0].screenY;
                    let deltaY = y - this._lastTouchY;
                    this._lastTouchY = y;
                    this.term.scrollLines(-Math.round(deltaY/10));
                }
            }, parentListener);
            parent.addEventListener("touchend", e => {
                this._lastTouchY = null;
            }, parentListener);
            parent.addEventListener("touchcancel", e => {
                this._lastTouchY = null;
            }, parentListener);

            const terminalTextarea = this.parent ? this.parent.querySelector('.xterm-helper-textarea') : null;
            if (terminalTextarea) terminalTextarea.addEventListener("keydown", e => {
                if (e.key === "F11" && window.settings.allowWindowed) {
                    e.preventDefault();
                    window.toggleFullScreen();
                }
            }, parentListener);
            if (parent) {
                parent.addEventListener("mousedown", () => this.focus(), parentListener);
                parent.addEventListener("touchstart", () => this.focus(), {...parentListener, passive: true});
            }

            this.forceRefresh = () => {
                const redraw = () => {
                    if (!this.isReady) return;
                    this.fit();
                    this.enableHardwareAcceleration();
                    if (typeof this.term.refresh === "function") {
                        this.term.refresh(0, this.term.rows - 1);
                    }
                };

                redraw();
                [60, 180, 360].forEach(delay => {
                    setTimeout(redraw, delay);
                });
            };

            this.fit = () => {
                this.lastRefit = Date.now();
                let {cols, rows} = this.fitAddon.proposeDimensions() || {};
                if (!cols || !rows) return;

                // Apply custom fixes based on screen ratio, see #302
                let w = screen.width;
                let h = screen.height;
                let x = 1;
                let y = 0;

                function gcd(a, b) {
                    return (b == 0) ? a : gcd(b, a%b);
                }
                let d = gcd(w, h);

                if (d === 100) { y = 1; x = 3;}
                // if (d === 120) y = 1;
                if (d === 256) x = 2;

                if (window.settings.termFontSize < 15) y = y - 1;

                cols = cols+x;
                rows = rows+y;

                if (this.term.cols !== cols || this.term.rows !== rows) {
                    this.resize(cols, rows);
                }
            };

            this.resize = (cols, rows) => {
                this.term.resize(cols, rows);
                if (this.isReady) this.Ipc.send(channel, "Resize", cols, rows);
            };

            this.write = data => {
                if (this.isReady) this.Ipc.send(channel, "Input", data);
            };

            this.writelr = cmd => this.write(cmd+"\r");
            this.term.onData(this.write);
            this.term.onBinary(data => this.write(Buffer.from(data, "latin1")));

            this.clipboard = {
                copy: () => {
                    if (!this.term.hasSelection()) return false;
                    document.execCommand("copy");
                    this.term.clearSelection();
                    this.clipboard.didCopy = true;
                },
                paste: () => {
                    this.write(remote.clipboard.readText());
                    this.clipboard.didCopy = false;
                },
                didCopy: false
            };

            let closed = false;
            this.dispose = () => {
                if (closed) return;
                closed = true;
                this.isReady = false;
                this.Ipc.removeListener(channel, receive);
                parentEvents.abort();
                this.disableHardwareAcceleration();
                this.term.dispose();
            };
            const receive = (_event, message, data) => {
                switch (message) {
                    case "Output":
                        writeOutput(data);
                        break;
                    case "New cwd":
                        this.cwd = data;
                        this.oncwdchange(this.cwd);
                        break;
                    case "Fallback cwd":
                        this.cwd = "FALLBACK |-- " + data;
                        this.oncwdchange(this.cwd);
                        break;
                    case "New process":
                        this.onprocesschange?.(data);
                        break;
                    case "Closed":
                        this.dispose();
                        this.onclose?.();
                        break;
                }
            };
            this.Ipc.on(channel, receive);
            this.ready = this.Ipc.invoke("terminal:attach", opts.id).then(() => {
                if (closed) throw new Error("Terminal has closed");
                this.isReady = true;
                this.forceRefresh();
                this.Ipc.send(channel, "Resize", this.term.cols, this.term.rows);
            });

        } else if (opts.role === "server") {

            this.Pty = require("node-pty");
            this.Ipc = require("electron").ipcMain;

            this.renderer = null;
            this.id = opts.id;
            const send = (message, data) => {
                if (this.renderer && !this.renderer.isDestroyed()) {
                    this.renderer.send(channel, message, data);
                }
            };

            this._closed = false;
            this.onclosed = () => {};
            this.onopened = () => {};
            this.onresized = () => {};

            this._disableCWDtracking = false;
            this._getTtyCWD = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    switch(require("os").type()) {
                        case "Linux":
                            require("fs").readlink(`/proc/${pid}/cwd`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd);
                                }
                            });
                            break;
                        case "Darwin":
                            require("child_process").exec(`lsof -a -d cwd -p ${pid} | tail -1 | awk '{ for (i=9; i<=NF; i++) printf "%s ", $i }'`, (e, cwd) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(cwd.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._getTtyProcess = tty => {
                return new Promise((resolve, reject) => {
                    let pid = tty._pid;
                    switch(require("os").type()) {
                        case "Linux":
                        case "Darwin":
                            require("child_process").exec(`ps -o comm --no-headers --sort=+pid -g ${pid} | tail -1`, (e, proc) => {
                                if (e !== null) {
                                    reject(e);
                                } else {
                                    resolve(proc.trim());
                                }
                            });
                            break;
                        default:
                            reject("Unsupported OS");
                    }
                });
            };
            this._nextTickUpdateTtyCWD = false;
            this._nextTickUpdateProcess = false;
            this._tick = setInterval(() => {
                if (this._nextTickUpdateTtyCWD && this._disableCWDtracking === false) {
                    this._nextTickUpdateTtyCWD = false;
                    this._getTtyCWD(this.tty).then(cwd => {
                        if (this.tty._cwd === cwd) return;
                        this.tty._cwd = cwd;
                        send("New cwd", cwd);
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while tracking TTY working directory: ", e);
                            this._disableCWDtracking = true;
                            send("Fallback cwd", opts.cwd || process.env.PWD);
                        }
                    });
                }

                if (this.renderer && this._nextTickUpdateProcess) {
                    this._nextTickUpdateProcess = false;
                    this._getTtyProcess(this.tty).then(process => {
                        if (this.tty._process === process) return;
                        this.tty._process = process;
                        send("New process", process);
                    }).catch(e => {
                        if (!this._closed) {
                            console.log("Error while retrieving TTY subprocess: ", e);
                            send("New process", "");
                        }
                    });
                }
            }, 1000);

            this.tty = this.Pty.spawn(opts.shell || "bash", (opts.params.length > 0 ? opts.params : (process.platform === "win32" ? [] : ["--login"])), {
                name: opts.env.TERM || "xterm-256color",
                cols: 80,
                rows: 24,
                cwd: opts.cwd || process.env.PWD,
                env: opts.env || process.env
            });

            let pendingOutput = "";
            const receive = (event, message, data, rows) => {
                if (!opts.isTrustedSender(event) || event.sender !== this.renderer) return;

                if (message === "Input") {
                    if (typeof data === "string") this.tty.write(data);
                    else if (data instanceof Uint8Array) this.tty.write(Buffer.from(data));
                } else if (message === "Resize" && Number.isInteger(data) && Number.isInteger(rows)
                    && data > 0 && data <= 65535 && rows > 0 && rows <= 65535) {
                    try {
                        this.tty.resize(data, rows);
                        this.onresized(data, rows);
                    } catch {
                        // The shell can exit while a resize is in flight.
                    }
                }
            };
            const dispose = () => {
                this._closed = true;
                clearInterval(this._tick);
                this.Ipc.removeListener(channel, receive);
                this.renderer = null;
                pendingOutput = "";
            };

            this.Ipc.on(channel, receive);
            this.tty.onData(data => {
                this._nextTickUpdateTtyCWD = true;
                this._nextTickUpdateProcess = true;
                if (this.renderer) send("Output", data);
                else pendingOutput = (pendingOutput + data).slice(-65536);
            });
            this.tty.onExit(({exitCode, signal}) => {
                if (this._closed) return;
                send("Closed");
                dispose();
                this.onclosed(exitCode, signal);
            });

            this.attach = renderer => {
                if (this._closed) return false;
                this.renderer = renderer;
                if (this._disableCWDtracking) {
                    send("Fallback cwd", opts.cwd || process.env.PWD);
                } else {
                    send("New cwd", this.tty._cwd || opts.cwd || process.env.PWD);
                }
                if (pendingOutput) {
                    send("Output", pendingOutput);
                    pendingOutput = "";
                }
                this.onopened(this.tty._pid);
                return true;
            };

            this.close = () => {
                if (this._closed) return;
                dispose();
                this.tty.kill();
            };
        } else {
            throw "Unknown purpose";
        }
    }
}

module.exports = {
    Terminal
};
