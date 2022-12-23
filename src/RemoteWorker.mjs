import * as WebSocket from "ws";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encode an object to be sent over a WebSocket connection.
 * @param {object} packet The packet to encode
 * @returns {Uint8Array} The encoded packet
 */
function encode(packet) {
    return textEncoder.encode(JSON.stringify(packet));
}

/**
 * Decode a packet received over a WebSocket connection.
 * @param {Uint8Array} packet The packet to decode
 * @returns {object} The decoded packet
 */
function decode(packet) {
    return JSON.parse(textDecoder.decode(packet));
}

class RemoteWorker {
    #events = {};

    /**
     * Emit an event. If the event is not defined, nothing will happen.
     * @param {string} event The event to listen for
     * @param  {...any} args Any arguments to pass to the callback
     * @returns {void}
     */
    #emit(event, ...args) {
        if (this.#events[event] !== undefined) {
            this.#events[event](...args);
        }
    }

    /**
     * Called when the WebSocket connection is opened.
     * @returns {void}
     * @private
     */
    #onopen() {
        this.#emit("open");
        this.on("invalidLogin", function(payload) {
            throw new Error("Failed to log in: " + payload);
        });
        this.send("login", {
            username: this.username,
            password: this.password
        });
    }

    /**
     * Called when a message is received from the server.
     * @param {MessageEvent} event The message event
     * @returns {void}
     * @private
     */
    #onmessage(event) {
        const packet = decode(event.data);
        if (packet.type === "login") {
            if (packet.payload.success) {
                this.#emit("authorized");
            } else {
                throw new Error("Failed to log in: " + packet.payload.reason);
            }
            return;
        }
        this.#emit("message", packet);
    }

    /**
     * Called when the WebSocket connection is closed.
     * @returns {void}
     * @private
     */
    #onclose() {
        this.#emit("close");
    }

    /**
     * Create a new RemoteWorker instance.
     * @param {string} host The host IP address
     * @param {number} port The port number
     * @param {string} username The username you will log in with
     * @param {string} password The password you will log in with
     */
    constructor(host, port, username, password) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
        this.packetIndex = 0;

        this.webSocket = new WebSocket(`ws://${this.host}:${this.port}`);
        this.webSocket.binaryType = "arraybuffer";
        this.webSocket.onopen = () => this.#onopen();
        this.webSocket.onmessage = (event) => this.#onmessage(event);
        this.webSocket.onclose = () => this.#onclose();
    }

    /**
     * Add an event to listen for. You can find the list of events in the module's root.
     * @param {string} event The event name
     * @param {function} callback The callback function
     * @returns {void}
     */
    on(event, callback) {
        this.#events[event] = callback;
    }

    /**
     * Send a packet to the server.
     * @param {string} packetType The packet type
     * @param {object} payload The packet payload
     * @returns {void}
     */
    send(packetType, payload) {
        if (this.webSocket.readyState !== this.webSocket.OPEN) {
            return;
        }
        const packet = encode({
            type: packetType,
            payload: payload
        });
        this.webSocket.send(packet, {
            binary: true
        });
    }
}

let clientID = 0;
class Client {
    #events = {};

    /**
     * Emit an event. If the event is not defined, nothing will happen.
     * @param {string} event The event to listen for
     * @param  {...any} args Any arguments to pass to the callback
     * @returns {void}
     */
    #emit(event, ...args) {
        if (this.#events[event] !== undefined) {
            this.#events[event](...args);
        }
    }

    /**
     * Called when a message is received from the client.
     * @param {MessageEvent} event The message event
     * @returns {void}
     * @private
     */
    #onmessage(message) {
        const packet = decode(message.data);
        if (packet.type === "login") {
            if (this.server.tryLogin(packet.payload.username, packet.payload.password)) {
                this.loggedIn = true;
                this.#emit("parentEmit", "successfulLogon", packet.payload.username);
                this.send("login", {
                    success: true
                });
            } else {
                this.#emit("parentEmit", "failedLogon", packet.payload.username);
                this.send("login", {
                    success: false,
                    reason: "Invalid credentials"
                });
                this.socket.terminate();
            }
            return;
        }
        this.#emit("message", packet);
    }

    /**
     * Called when the WebSocket connection is closed.
     * @returns {void}
     * @private
     */
    #onclose() {
        this.server.clients.delete(this.id);
        this.#emit("close");
    }

    /**
     * Create a new Client instance.
     * @param {object} socket The actual WebSocket connection 
     * @param {object} request The request object containing headers and other information
     * @param {RemoteServer} server The remote server instance 
     */
    constructor(socket, request, server) {
        this.socket = socket;
        this.request = request;
        this.server = server;
        this.id = clientID ++;

        this.socket.binaryType = "arrayBuffer";
        this.socket.onmessage = (event) => this.#onmessage(event);
        this.socket.onclose = () => this.#onclose();
        this.loggedIn = false;
    }

    /**
     * Add an event to listen for. You can find the list of events in the module's root.
     * @param {string} event The event name
     * @param {function} callback The callback function
     * @returns {void}
     */
    on(event, callback) {
        this.#events[event] = callback;
    }

    /**
     * Send a packet to the client.
     * @param {string} packetType The packet type
     * @param {object} payload The packet payload
     * @returns {void}
     */
    send(packetType, payload) {
        if (this.socket.readyState !== this.socket.OPEN) {
            return;
        }
        const packet = encode({
            type: packetType,
            payload: payload
        });
        this.socket.send(packet, {
            binary: true
        });
    }
}

class Logon {
    #username;
    #password;

    /**
     * Create a new Logon instance.
     * @param {string} username The username
     * @param {string} password The password
     */
    constructor(username, password) {
        this.#username = username;
        this.#password = password;
        this.active = false;
    }

    /**
     * Try to login with the given credentials.
     * @param {string} username The username
     * @param {string} password The password
     * @returns {boolean} Whether the login was successful
     */
    login(username, password) {
        if (this.active || this.#username !== username || this.#password !== password) {
            return false;
        }

        return this.active = true;
    }

    /**
     * Logout of the logon.
     * @returns {void}
     */
    logout() {
        this.active = false;
    }
}

class RemoteServer {
    #events = {};
    #logons = {};

    /**
     * Emit an event. If the event is not defined, nothing will happen.
     * @param {string} event The event to listen for
     * @param  {...any} args Any arguments to pass to the callback
     * @returns {void}
     */
    #emit(event, ...args) {
        if (this.#events[event] !== undefined) {
            this.#events[event](...args);
        }
    }
    
    /**
     * Create a connection and add it to the server's client list
     * @param {object} socket The actual WebSocket connection
     * @param {object} request The request object containing headers and other information
     * @returns {void}
     * @private
     */
    #addConnection(socket, request) {
        const client = new Client(socket, request, this);
        client.on("parentEmit", (event, ...args) => {
            this.#emit(event, ...args);
        });
        this.clients.set(client.id, client);
        this.#emit("connection", client);
    }

    /**
     * Create a new RemoteServer instance.
     * @param {number} port The port to listen on
     * @returns {void}
     */
    constructor(port) {
        this.port = port;
        this.server = new WebSocket.Server({
            port: port
        });
        this.server.on("connection", (socket, request) => this.#addConnection(socket, request));
        this.clients = new Map();
    }

    /**
     * Add an event to listen for. You can find the list of events in the module's root.
     * @param {string} event The event name
     * @param {function} callback The callback function
     * @returns {void}
     */
    on(event, callback) {
        this.#events[event] = callback;
    }

    /**
     * Add a logon to the server. Only one connection is allowed under this username at a time.
     * @param {string} username The username
     * @param {string} password The password
     * @returns {void}
     */
    addLogon(username, password) {
        this.#logons[username] = new Logon(username, password);
    }

    /**
     * Attempt to login with the given credentials.
     * @param {string} username The username
     * @param {string} password The password
     * @returns {boolean} Whether the login was successful
     */
    tryLogin(username, password) {
        if (this.#logons[username] === undefined) {
            return false;
        }
        return this.#logons[username].login(username, password);
    }
}

Object.defineProperty(RemoteWorker, "RemoteWorker", {
    value: RemoteWorker,
    writable: false,
    enumerable: false,
    configurable: false
});

Object.defineProperty(RemoteWorker, "RemoteServer", {
    value: RemoteServer,
    writable: false,
    enumerable: false,
    configurable: false
});

Object.defineProperty(RemoteWorker, "createdAt", {
    value: new Date(),
    writable: false,
    enumerable: false,
    configurable: false
});

Object.defineProperty(RemoteWorker, "encode", {
    value: encode,
    writable: false,
    enumerable: false,
    configurable: false
});

Object.defineProperty(RemoteWorker, "decode", {
    value: decode,
    writable: false,
    enumerable: false,
    configurable: false
});

Object.defineProperty(RemoteWorker, "events", {
    value: {
        [RemoteServer.name]: [
            "connection",
            "failedLogon",
            "successfulLogon"
        ],
        [Client.name]: [
            "message",
            "close"
        ],
        [RemoteWorker.name]: [
            "open",
            "authorized",
            "message",
            "close"
        ]
    },
    writable: false,
    enumerable: false,
    configurable: false
});

export default RemoteWorker;
