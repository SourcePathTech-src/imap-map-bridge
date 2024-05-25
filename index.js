const {
  Cli,
  Bridge,
  AppServiceRegistration,
} = require("matrix-appservice-bridge");
const nodemailer = require("nodemailer");
const imaps = require("imap-simple");
const fs = require("fs");
const yaml = require("js-yaml");

// Load config
const config = yaml.load(fs.readFileSync("config.yaml", "utf8"));

// Set up IMAP client
const imapConfig = {
  imap: config.imap,
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
          const event = request.getData();
          if (
            event.type !== "m.room.message" ||
            !event.content ||
            event.room_id !== config.matrix.roomId
          ) {
            return;
          }
          const mailOptions = {
            from: config.smtp.auth.user,
            to: "recipient@example.com", // Replace with actual recipient
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
    console.log("Matrix-side listening on port %s", port);
    bridge.run(port);
  },
}).run();

// Set up IMAP client to check for new emails
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
              const parts = imaps.getParts(message.attributes.struct);
              const email = parts.filter((part) => part.which === "TEXT")[0];
              const intent = bridge.getIntent(config.matrix.botUserId);
              intent.sendText(config.matrix.roomId, email.body);
            });
          });
      });
    })
    .catch((err) => {
      console.log("Error checking email:", err);
    });
}

// Check for new emails every minute
setInterval(checkEmail, 60000);
