# imap-map-bridge

## Usage instructions
> **Note**: 9000 here, is a port of your choise for the bridge to listen for connections from appservice.
* Clone the repo
* Install dependencies with `npm install` 
* Rename example-config.yaml to config.yaml and edit it
* Run `node index.js -r -u "http://localhost:9000"` to generate `mail-registration.yaml`
* Add the path to mail-registration.yaml in homeserver.yaml under `app_service_config_files:`
* Run it with `node index.js -p 9001`
