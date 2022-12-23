const RemoteWorker = require("./rsmx.js");

// Create a server on port 3000
let server = new RemoteWorker.RemoteServer(3000);

// Add logon users
server.addLogon("user1", "pass1");
server.addLogon("user2", "pass2");

// Notify when someone logs in correctly
server.on("successfulLogon", function(username) {
    console.log(`Successful logon attempt from user ${username}`);
});

// Notify when someone logs in incorrectly
server.on("failedLogon", function(username) {
    console.log(`Failed logon attempt from user ${username}`);
});

// Handle a client's connection
server.on("connection", function(client) {
    console.log(`Client ${client.id} is connecting!`);
    client.on("message", function(packet) {
        console.log(`Incoming message from client ${client.id}`, packet);
    });
});
