const RemoteWorker = require("./rsmx.js");

// Create a client, connect to the server on port 3000, and login with the user "user1" and password "pass1"
const client = new RemoteWorker("127.0.0.1", 3000, "user1", "pass1");

// Notify when the connection is opened
client.on("open", function onOpen() {
    console.log("Connection opened!");
});

// Notify when the connection is authorized
client.on("authorized", function onAuthorized() {
    console.log("Connection authorized!");
});

// Notify when there is a message event
client.on("message", function onMessage(packet) {
    console.log("Incoming message!", packet);
});

// Notify when the connection is closed
client.on("close", function onClose() {
    console.log("Connection closed!");
});
