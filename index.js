import { Cli, Bridge, AppServiceRegistration } from "matrix-appservice-bridge";
import nodemailer from "nodemailer";
import Imap from "node-imap";
import { simpleParser } from "mailparser";
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
  user: config.imap.user,
  password: config.imap.password,
  host: config.imap.host,
  port: config.imap.port,
  tls: config.imap.tls,
  tlsOptions: { rejectUnauthorized: false },
};

const imap = new Imap(imapConfig);

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
  run: function (port) {
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
            to: "target@yopmail.com", // Make configurable if needed
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

        bridge
          .getIntent(config.matrix.botUserId)
          .ensureRegistered()
          .then(() => {
            console.log(`Bot ${config.matrix.botUserId} has been registered.`);
            return bridge
              .getIntent(config.matrix.botUserId)
              .join(config.matrix.roomId);
          })
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
            if (err.errcode === "M_USER_IN_USE") {
              console.log(
                `User ${config.matrix.botUserId} is already registered.`,
              );
              return bridge
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
                });
            } else {
              console.error(`Failed to join room or send greeting: ${err}`);
            }
          });
      })
      .catch((err) => {
        console.error(`Failed to initialize the bridge: ${err}`);
      });
  },
}).run();

function openInbox(cb) {
  imap.openBox("INBOX", false, cb);
}

function checkEmail() {
  imap.once("ready", () => {
    openInbox((err, box) => {
      if (err) throw err;
      imap.search(["UNSEEN"], (err, results) => {
        if (err) throw err;
        if (!results || !results.length) {
          console.log("No new emails");
          imap.end();
          return;
        }
        const f = imap.fetch(results, { bodies: "" });
        f.on("message", (msg, seqno) => {
          msg.on("body", (stream, info) => {
            simpleParser(stream, (err, mail) => {
              if (err) throw err;
              const emailFrom = mail.from.value[0].address.replace("@", "_");
              const plainText = mail.text || "No content";
              const intent = bridge.getIntent(
                "@mail_" + emailFrom + ":" + config.matrix.domain,
              );
              intent.sendText(config.matrix.roomId, plainText);
            });
          });
          msg.once("attributes", (attrs) => {
            imap.addFlags(attrs.uid, ["\\Seen"], (err) => {
              if (err) throw err;
              console.log("Marked as read");
            });
          });
        });
        f.once("error", (err) => {
          console.log("Fetch error: " + err);
        });
        f.once("end", () => {
          console.log("Done fetching all messages!");
          imap.end();
        });
      });
    });
  });

  imap.once("error", (err) => {
    console.log(err);
  });

  imap.once("end", () => {
    console.log("Connection ended");
  });

  imap.connect();
}

// Checking for new emails every minute
setInterval(checkEmail, 60000);
