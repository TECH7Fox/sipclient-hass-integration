import "./sip-call-dialog.js";


const version = "0.1.7";

console.info(
    `%c SIP-CORE %c ${version} `,
    'color: white; background: dodgerblue; font-weight: 700;',
    'color: dodgerblue; background: white; font-weight: 700;',
);


class CALLSTATE {
    static IDLE = "IDLE";
    static INCOMING = "INCOMING CALL...";
    static CALLING = "CALLING...";
    static CONNECTING = "CONNECTING...";
    static CONNECTED = "CONNECTED";
}


class SIPCore {
    constructor() {
        this.pc = null;
        this.call_id = "";
        this.call_state = CALLSTATE.IDLE;
        this.caller = "";
        this.callee = "";
        this.config = {};
        this.timer = "00:00";
        this.audioStream = null;
        this.hass = document.getElementsByTagName("home-assistant")[0].hass;
        fetch('/local/sip-config.json?' + new Date().getTime())
            .then(response => {
                console.log("config response: ", response);
                return response.json();
            })
            .then(data => {
                console.log("config loaded: ", data);
                this.config = data;

                this.number = this.config.username;
                this._setupEvents();
                
                if (this.config.popup) {
                    this._setupPopup();
                    window.addEventListener('location-changed', () => {
                        console.log("location changed!");
                        this._setupButton();
                    });
                    this._setupButton();
                }
            });
        // TODO: Dynamically import sip-call-dialog.js?
    }

    _setupButton() {
        const dialog = document.getElementsByTagName("sip-call-dialog")[0];
        const panel = document.getElementsByTagName("home-assistant")[0]
            .shadowRoot.querySelector("home-assistant-main")
            .shadowRoot.querySelector("ha-panel-lovelace")
            
        if (panel === null) {
            console.log("panel not found!");
            return;
        }

        const actionItems = panel.shadowRoot.querySelector("hui-root")
            .shadowRoot.querySelector(".action-items");

        if (actionItems.querySelector("#sipcore-call-button"))
            return;

        const callButton = document.createElement("ha-icon-button");
        callButton.label = "Open Call Popup";
        const icon = document.createElement("ha-icon");
        icon.style = "display: flex; align-items: center; justify-content: center;";
        icon.icon = "mdi:phone";
        callButton.slot = "actionItems";
        callButton.id = "sipcore-call-button";
        callButton.appendChild(icon);
        callButton.addEventListener("click", () => {
            console.log("open call dialog!");
            dialog.open = true;
        });
        actionItems.appendChild(callButton);
    }

    _setupPopup() {
        let POPUP_COMPONENT = "sip-call-dialog";
        if (this.config.override_popup_component) {
            POPUP_COMPONENT = this.config.override_popup_component;
        }
        if (document.getElementsByTagName(POPUP_COMPONENT).length < 1) {
            const dialog = document.createElement(POPUP_COMPONENT);
            document.body.appendChild(dialog);
        }
    }

    _triggerUpdate() {
        const event = new CustomEvent("sipcore-update", {
            detail: {},
            bubbles: true,
            composed: true,
        });
        window.dispatchEvent(event);
    }

    _startTimer() {
        let minutes = 0;
        let seconds = 0;
        this.timerId = setInterval(() => {
            seconds++;
            if (seconds === 60) {
                minutes++;
                seconds = 0;
            }
            this.timer = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            this._triggerUpdate();
        }, 1000);
    }

    _stopTimer() {
        clearInterval(this.timerId);
        this.timer = "00:00";
    }

    async _setupEvents() {
        console.log("connecting...");
        this.hass.connection.subscribeEvents(async (event) => {
            console.log("incoming call event", event);
            this.call_id = event.data.call_id;
            this.caller = event.data.caller;
            this.callee = event.data.callee;
            this.call_state = CALLSTATE.INCOMING;
            this.pc = this._createPc();
            const offer = new RTCSessionDescription({sdp: event.data.sdp, type: "offer"})
            await this.pc.setRemoteDescription(offer);
            console.log("incoming offer sdp: ", event.data.sdp);
            this._triggerUpdate();
        }, "sipclient_incoming_call_event");

        this.hass.connection.subscribeEvents(async (event) => {
            console.log("outgoing call event", event);
            this.call_id = event.data.call_id;
            this.call_state = CALLSTATE.CALLING;
            const answer = new RTCSessionDescription({sdp: event.data.sdp, type: "answer"})
            await this.pc.setRemoteDescription(answer);
            console.log("incoming answer sdp: ", event.data.sdp);
            this._triggerUpdate();
        }, "sipclient_outgoing_call_event");

        this.hass.connection.subscribeEvents((event) => {
            console.log("call ended event", event);
            this._stopTimer();
            this.call_state = CALLSTATE.IDLE;
            this.pc.close();
            this.pc = null;
            this.audioStream = null;
            this.call_id = "";
            this._triggerUpdate();
        }, "sipclient_call_ended_event");

        // seek for existing calls
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_seek_call_event",
            event_data: {
                number: this.config.username,
            },
        });
    }

    _createPc() {
        const configuration = {
            'iceServers': [
                {
                    'urls': 'stun:stun.l.google.com:19302'
                }
            ]
        };
        const pc = new RTCPeerConnection(configuration);

        pc.onconnectionstatechange = (event) => {
            console.log("onconnectionstatechange", event);
            switch (pc.connectionState) {
                case "connected":
                    this.call_state = CALLSTATE.CONNECTED;
                    this._startTimer();
                    break;
                case "disconnected":
                case "failed":
                case "closed":
                    this._stopTimer();
                    this.call_state = CALLSTATE.IDLE;
                    break;
                default:
                    console.log("unknown connection state: ", pc.connectionState);
                    break;
            }
            this._triggerUpdate();
        }

        pc.ontrack = (event) => {
            console.log("ontrack", event);
            this.audioStream = event.streams[0];
            let audio = document.getElementById("sipcore-audio");
            if (!audio) {
                audio = document.createElement("audio");
                audio.id = "sipcore-audio";
                audio.autoplay = true;
                audio.controls = true;
                audio.style.display = "none";
            }
            audio.srcObject = event.streams[0];
        }

        pc.onicegatheringstatechange = (event) => {
            console.log("onicegatheringstatechange", event);
            this._triggerUpdate();
        }

        pc.oniceconnectionstatechange = (event) => {
            console.log("oniceconnectionstatechange", event);
            this._triggerUpdate();
        }

        return pc;
    }

    async _addMedia() {
        const stream = await navigator.mediaDevices.getUserMedia(
            {
                video: false,
                audio: true,
            }
        );
        for (const track of stream.getTracks()) {
            console.log("Adding track: ", track.kind)
            this.pc.addTrack(track, stream);
        }
    }

    _waitForIceGathering() {
        return new Promise((resolve) => {
            if (this.pc.iceGatheringState === "complete") {
                resolve();
            } else {
                const timeout = setTimeout(() => {
                    resolve();
                }, this.config.ice_timeout);
                this.pc.onicecandidate = (event) => {
                    if (event.candidate === null) {
                        clearTimeout(timeout);
                        resolve();
                    }
                };
            }
        });
    }

    async startCall(to) {
        console.log("call clicked!");
        this.pc = this._createPc();
        await this._addMedia();

        this.pc.createOffer().then((offer) => {
            return this.pc.setLocalDescription(offer);
        }).then(
            this._waitForIceGathering.bind(this)
        ).then(() => {
            const offer = this.pc.localDescription;
            this.caller = this.number;
            this.callee = to;
            this.hass.connection.sendMessagePromise({
                type: "fire_event",
                event_type: "sipclient_start_call_event",
                event_data: {
                    sdp: offer.sdp,
                    caller: this.caller,
                    callee: this.callee,
                    sdp: offer.sdp,
                }
            });
        });
    }

    async denyCall() {
        console.log("deny clicked!");
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_deny_call_event",
            event_data: {
                call_id: this.call_id,
                callee: this.callee,
                caller: this.caller,
            }
        });
    }

    async endCall() {
        console.log("end clicked!");
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_end_call_event",
            event_data: {
                call_id: this.call_id,
                callee: this.callee,
                caller: this.caller,
                reason: "user ended call",
            }
        });
    }

    async answerCall() {
        console.log("answer clicked!");
        await this._addMedia();
        this.pc.createAnswer().then((answer) => {
            return this.pc.setLocalDescription(answer);
        }).then(
            this._waitForIceGathering.bind(this)
        ).then(() => {
            const answer = this.pc.localDescription;

            this.hass.connection.sendMessagePromise({
                type: "fire_event",
                event_type: "sipclient_answer_call_event",
                event_data: {
                    call_id: this.call_id,
                    sdp: answer.sdp,
                }
            });
        });
    }
}

const sipCore = new SIPCore();
// window.sipCore = sipCore; // TODO: plan B
export { sipCore, CALLSTATE };
