const version = "0.1.6";

console.info(
    `%c SIP-CORE %c ${version} `,
    'color: white; background: dodgerblue; font-weight: 700;',
    'color: dodgerblue; background: white; font-weight: 700;',
);


class SIPCore {
    constructor() {
        this.pc = null;
        this.call_id = "";
        this.call_state = "idle"; // ???
        this.caller = "";
        this.callee = "";
        this.config = { // TODO: Temp
            from: "1000",
            ice_timeout: 1000,
        };
        this.number = this.config.from;
        this.hass = document.getElementsByTagName("home-assistant")[0].hass;
        this._setupEvents();
    }

    _triggerUpdate() {
        const event = new CustomEvent("sipcore-update", {
            detail: {},
            bubbles: true,
            composed: true,
        });
        window.dispatchEvent(event);
    }

    async _setupEvents() {
        console.log("connecting...");
        this.hass.connection.subscribeEvents(async (event) => {
            console.log("incoming call event", event);
            this.call_id = event.data.call_id;
            this.caller = event.data.caller;
            this.callee = event.data.callee;
            this.pc = this._createPc();
            const offer = new RTCSessionDescription({sdp: event.data.sdp, type: "offer"})
            await this.pc.setRemoteDescription(offer);
            console.log("incoming offer sdp: ", event.data.sdp);
            this._triggerUpdate();
        }, "sipclient_incoming_call_event");

        this.hass.connection.subscribeEvents(async (event) => {
            console.log("outgoing call event", event);
            this.call_id = event.data.call_id;
            const answer = new RTCSessionDescription({sdp: event.data.sdp, type: "answer"})
            await this.pc.setRemoteDescription(answer);
            console.log("incoming answer sdp: ", event.data.sdp);
            this._triggerUpdate();
        }, "sipclient_outgoing_call_event");

        this.hass.connection.subscribeEvents((event) => {
            console.log("call ended event", event);
            this.pc.close();
            this.pc = null;
            this.call_id = "";
            this._triggerUpdate();
        }, "sipclient_call_ended_event");

        // seek for existing calls
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_seek_call_event",
            event_data: {
                number: this.config.from,
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
            this._triggerUpdate();
        }

        pc.ontrack = (event) => {
            console.log("ontrack", event);
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
export { sipCore };
