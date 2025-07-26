"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { server: WebSocketServer } = require("websocket");


const app = express();
const HTTP_SERVER_PORT = 8081;

const twilio = {
    accountSid : "AC5eb00789706e66f99a5845f749a0e6bb",
    authToken : "b27bb9337b344a797aed211243b178d9",
    fromNo: '+17855092245',
}

// Create an HTTP server and bind it to Express
const server = http.createServer(app);

// WebSocket server over the same HTTP server
const mediaws = new WebSocketServer({
  httpServer: server,
  autoAcceptConnections: true,
});

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

app.get("/ping", (req, res) => {
  res.send("Hello World!!!!");
});

// Define TwiML endpoint (formerly dispatcher.onPost)
app.post("/twiml", (req, res) => {
  log("POST TwiML");

  const filePath = path.join(__dirname, "templates", "streams.xml");

  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.status(500).send("Error reading TwiML file");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/xml",
      "Content-Length": stat.size,
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);

    console.log("sent command to the server");

  });
});

// WebSocket handling
mediaws.on("connect", function (connection) {
  log("Media WS: Connection accepted");
  new MediaStream(connection);
});

class MediaStream {
  dataCollector = [];
  constructor(connection) {
    connection.on("message", this.processMessage.bind(this));
    connection.on("close", this.close.bind(this));
    this.hasSeenMedia = false;
    this.messageCount = 0;
  }

  processMessage(message) {
    if (message.type === "utf8") {
      const data = JSON.parse(message.utf8Data);
      if (data.event === "connected") {
        log("Media WS: Connected event received: ", data);
      }
      if (data.event === "start") {
        log("Media WS: Start event received: ", data);
      }
      if (data.event === "media") {
        if (!this.hasSeenMedia) {
          log("Media WS: Media event received: ", data);
          log("Media WS: Suppressing additional messages...");
          this.hasSeenMedia = true;
        }
      }
      if (data.event === "stop") {
        log("Media WS: Stop event received: ", data);
        console.log("dataCollector length ->>> ", this.dataCollector.length);
        // Write dataCollector to file when stop event is received
        const fs = require('fs');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `audio_data_${timestamp}.json`;
        
        try {
          const path = require('path');
          const fullPath = path.join(process.cwd(), filename);
          console.log("fullPath ->>> ", fullPath)
          fs.writeFileSync(fullPath, JSON.stringify(this.dataCollector, null, 2));
          console.log(`Audio data saved to: ${fullPath}`);
          console.log(`File exists: ${fs.existsSync(fullPath)}`);
          console.log(`File size: ${fs.statSync(fullPath).size} bytes`);
        } catch (error) {
          console.error('Error writing audio data to file:', error);
        }
      }
    //   log(" data received ->>> ", data)
      this.dataCollector.push(data);
      this.messageCount++;
    } else if (message.type === "binary") {
      log("Media WS: binary message received (not supported)");
    } else {
        log("Media WS: message received");
    }
  }

  close() {
    log(
      `Media WS: Stopped. Received a total of [${this.messageCount}] messages`
    );
  }
}

// Start the server
server.listen(HTTP_SERVER_PORT, () => {
  console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`);
});