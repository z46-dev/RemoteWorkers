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

/**
 * Events list that can be emitted by a Client or RemoteWorker.
 * @readonly
 * @enum {number}
 * @property {number} OPEN The connection has been opened.
 * @property {number} CLOSE The connection has been closed.
 * @property {number} MESSAGE A message has been received.
 * @property {number} ERROR An error has occurred.
 * @property {number} SUCCESSFUL_LOGON A successful logon has occurred.
 * @property {number} FAILED_LOGON A failed logon has occurred.
 */
export const events = {
    OPEN: 0,
    CLOSE: 1,
    MESSAGE: 2,
    ERROR: 3,
    SUCCESSFUL_LOGON: 4,
    FAILED_LOGON: 5
};

const reverseObjectEvents = Object.entries(events).reduce((acc, [key, value]) => {
    acc[value] = key;
    return acc;
}, {});

/**
 * Packets list that can be sent by a Client or RemoteWorker, these are the default packets.
 * @readonly
 * @enum {number}
 * @property {number} LOGIN The login packet.
 */
export const packets = {
    LOGIN: 0x00
};

// Client Architecture
export class RemoteWorker {
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
        this.#emit(events.OPEN);

        this.send(packets.LOGIN, {
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

        if (packet.type === packets.LOGIN) {
            if (packet.payload.success) {
                this.#emit(events.SUCCESSFUL_LOGON);
                return;
            }

            this.#emit(events.FAILED_LOGON);
            return;
        }

        this.#emit(events.MESSAGE, packet);
    }

    /**
     * Called when the WebSocket connection is closed.
     * @returns {void}
     * @private
     */
    #onclose() {
        this.#emit(events.CLOSE);
    }

    /**
     * Create a new RemoteWorker instance.
     * @param {string} host The host IP address
     * @param {number} port The port number
     * @param {string} username The username you will log in with
     * @param {string} password The password you will log in with
     */
    constructor(host, port, username, password, https = false) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
        this.packetIndex = 0;

        this.webSocket = new WebSocket.WebSocket(`${https ? "wss" : "ws"}://${this.host}:${this.port}`);
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
        if (reverseObjectEvents[event] === undefined) {
            throw new Error(`Event ${event} does not exist.`);
        }

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

// Server Architecture
export class RemoteServerClient {
    static idCounter = 0;

    #username; // Provided with a getter, no setter
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

        if (packet.type === packets.LOGIN) {
            if (this.server.tryLogin(packet.payload.username, packet.payload.password)) {
                this.loggedIn = true;
                this.#username = packet.payload.username;

                this.#emit(events.SUCCESSFUL_LOGON, packet.payload.username);

                this.send(packets.LOGIN, {
                    success: true
                });
                return;
            }

            this.#emit(events.FAILED_LOGON, packet.payload.username);

            this.send(packets.LOGIN, {
                success: false,
                reason: "Invalid credentials"
            });

            this.socket.terminate();
            return;
        }

        this.#emit(events.MESSAGE, packet);
    }

    /**
     * Called when the WebSocket connection is closed.
     * @returns {void}
     * @private
     */
    #onclose() {
        this.server.logout(this.#username);

        this.server.clients.delete(this.id);

        this.#emit(events.CLOSE);
    }

    /**
     * Create a new Client instance.
     * @param {WebSocket} socket The actual WebSocket connection 
     * @param {WebSocket.Connection} request The request object containing headers and other information
     * @param {RemoteServer} server The remote server instance 
     */
    constructor(socket, request, server) {
        this.socket = socket;
        this.request = request;
        this.server = server;
        this.id = RemoteServerClient.idCounter ++;

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
        if (reverseObjectEvents[event] === undefined) {
            throw new Error(`Event ${event} does not exist.`);
        }

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

export class RemoteServer {
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
        const client = new RemoteServerClient(socket, request, this);

        this.clients.set(client.id, client);

        this.#emit(events.OPEN, client);
    }

    /**
     * Create a new RemoteServer instance.
     * @param {number} port The port to listen on
     * @returns {void}
     */
    constructor(port) {
        this.port = port;

        this.server = new WebSocket.WebSocketServer({
            port: port
        });

        this.server.on("connection", (socket, request) => {
            this.#addConnection(socket, request);
        });
        
        this.clients = new Map();
    }

    /**
     * Add an event to listen for. You can find the list of events in the module's root.
     * @param {string} event The event name
     * @param {function} callback The callback function
     * @returns {void}
     */
    on(event, callback) {
        if (reverseObjectEvents[event] === undefined) {
            throw new Error(`Event ${event} does not exist.`);
        }

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
     * Remove a logon from the server.
     * @param {string} username The username
     * @returns {void}
     */
    logout(username) {
        if (this.#logons[username] === undefined) {
            return;
        }

        this.#logons[username].logout();
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

export default RemoteWorker;
