import { Cli, Bridge, AppServiceRegistration } from "matrix-appservice-bridge";
import nodemailer from "nodemailer";
import imaps from "imap-simple";
import fs from "fs";
import yaml from "js-yaml";
import { parseEmail } from "./parse-email.js";

// Load config with logging
let config;
try {
  config = yaml.load(fs.readFileSync("config.yaml", "utf8"));
  console.log("Configuration loaded successfully:", config);
} catch (err) {
  console.error("Failed to load configuration:", err);
  process.exit(1);
}

if (!config || !config.matrix) {
  console.error(
    "Invalid configuration structure. 'matrix' section is missing.",
  );
  process.exit(1);
}

// Set up IMAP client
const imapConfig = {
  imap: {
    ...config.imap,
    tlsOptions: { rejectUnauthorized: false }, // Add this line to ignore self-signed certificates
  },
};

// Set up SMTP client
const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.auth.user,
    pass: config.smtp.auth.pass,
  },
});

let bridge;

new Cli({
  registrationPath: "mail-registration.yaml",
  generateRegistration: function (reg, callback) {
    reg.setId(AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("mailbot");
    reg.addRegexPattern("users", "@mail_.*", true);
    callback(reg);
  },
  run: function (port, config) {
    bridge = new Bridge({
      homeserverUrl: config.matrix.homeserverUrl,
      domain: config.matrix.domain,
      registration: "mail-registration.yaml",
      controller: {
        onUserQuery: function (queriedUser) {
          return {}; // auto-provision users with no additional data
        },
        onEvent: function (request, context) {
          console.log("Received event:", request.getData());
          const event = request.getData();
          if (
            event.type !== "m.room.message" ||
            !event.content ||
            event.room_id !== config.matrix.roomId
          ) {
            return;
          }

          console.log("Body content:", event.content.body);
          const mailOptions = {
            from: config.smtp.auth.user,
            to: "target@yopmail.com", // This needs to be configurable
            subject: "Matrix Message",
            text: event.content.body,
          };
          transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
              console.log("Error sending email:", error);
            } else {
              console.log("Email sent:", info.response);
            }
          });
        },
      },
    });

    bridge
      .run(port)
      .then(() => {
        console.log("Matrix-side listening on port %s", port);

        // Ensure the bot joins the room and sends a greeting message
        bridge
          .getIntent(config.matrix.botUserId)
          .join(config.matrix.roomId)
          .then(() => {
            console.log(
              `Bot ${config.matrix.botUserId} has joined the room ${config.matrix.roomId}`,
            );
            return bridge
              .getIntent(config.matrix.botUserId)
              .sendText(
                config.matrix.roomId,
                "Hello! The bridge is now up and running.",
              );
          })
          .then(() => {
            console.log("Greeting message sent to the room.");
          })
          .catch((err) => {
            console.error(`Failed to join room or send greeting: ${err}`);
          });
      })
      .catch((err) => {
        console.error(`Failed to initialize the bridge: ${err}`);
      });
  },
}).run();

// IMAP Client to check for new emails
function checkEmail() {
  imaps
    .connect(imapConfig)
    .then((connection) => {
      return connection.openBox("INBOX").then(() => {
        const searchCriteria = ["UNSEEN"];
        const fetchOptions = {
          bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)", "TEXT"],
          markSeen: true,
        };
        return connection
          .search(searchCriteria, fetchOptions)
          .then((messages) => {
            messages.forEach((message) => {
              if (message.parts) {
                const textPart = message.parts.find(
                  (part) => part.which === "TEXT",
                );
                const headerPart = message.parts.find(
                  (part) =>
                    part.which === "HEADER.FIELDS (FROM TO SUBJECT DATE)",
                );
                if (textPart && headerPart) {
                  const headers = Imap.parseHeader(headerPart.body);
                  const emailFrom = headers.from
                    ? headers.from[0].replace('@', '_')
                    : "unknown_sender";
                  const { plainText } = parseEmail(textPart.body);
                  const intent = bridge.getIntent('@mail_' + emailFrom + ":" + config.matrix.domain);
                  intent.sendText(config.matrix.roomId, plainText);
                } else {
                  console.log("No text part found for message:", message);
                }
              } else {
                console.log("No parts found for message:", message);
              }
            });
          });
      });
    })
    .catch((err) => {
      console.log("Error checking email:", err);
    });
}

// Checking for new emails every minute
setInterval(checkEmail, 60000);
