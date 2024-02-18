import {
    LitElement,
    html,
    css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";

console.info(
    `%c SIP-CORE %c 0.1.1 `,
    'color: white; background: dodgerblue; font-weight: 700;',
    'color: dodgerblue; background: white; font-weight: 700;',
);

class ContentCardExample extends LitElement {

    static get properties() {
        return {
            hass: {},
            config: {},
            call_id: "",
        };
    }

    static get styles() {
        return css`
            ha-card {
                /* sample css */
            }
        `;
    }

    render() {
        const connection_state = this.pc ? this.pc.connectionState : "unavailable";
        return html`
            <ha-card header="SIP Core test 0.1.1">
                call_id: ${this.call_id}
                <br>
                connection_state: ${connection_state}
                <br><br>
                <button
                    id="callButton"
                    @click="${this.start_call}"
                >call</button>
                <button
                    id="denyButton"
                    @click="${this.deny_call}"
                >deny</button>
                <button
                    id="answerButton"
                    @click="${this.answer_call}"
                >answer</button>
                <button
                    id="endButton"
                    @click="${this.end_call}"
                >end</button>
                <br>
                <br>
                <audio id="audio" autoplay controls></audio>
            </ha-card>
        `;
    }

    // The user supplied configuration. Throw an exception and Home Assistant
    // will render an error card.
    setConfig(config) {
        if (!config.entity) {
            throw new Error("You need to define an entity");
        }
        this.config = config;
    }

    firstUpdated() {
        console.log("firstUpdated");
        this.connect();
    }

    // The height of your card. Home Assistant uses this to automatically
    // distribute all cards over the available columns.
    getCardSize() {
        return 3;
    }

    async connect() {
        console.log("connecting...");
        this.hass.connection.subscribeEvents((event) => {
            console.log("incoming call event", event);
            this.call_id = event.data.call_id;
            this.pc = this.create_pc();
            const offer = new RTCSessionDescription({sdp: event.data.sdp, type: "offer"})
            this.pc.setRemoteDescription(offer); // TODO: async?
            this.requestUpdate();
            // TODO: trigger display of answer button
        }, "sipclient_incoming_call_event");

        this.hass.connection.subscribeEvents((event) => {
            console.log("outgoing call event", event);
            this.call_id = event.data.call_id;
            const answer = new RTCSessionDescription({sdp: event.data.sdp, type: "answer"})
            console.log("Received sdp: ", answer.sdp);
            this.pc.setRemoteDescription(answer); // TODO: Wait for ice?
            this.requestUpdate();
        }, "sipclient_outgoing_call_event");

        this.hass.connection.subscribeEvents(async (event) => {
            // while (!this.call_id) {
            //     console.log("waiting for call_id to be set for incoming candidate");
            //     await new Promise(r => setTimeout(r, 1000));
            // }
            if (event.data.call_id == this.call_id && event.data.for == "client") {
                try {
                console.log("adding ICE candidate: ", event);
                    this.pc.addIceCandidate(event.candidate);
                } catch (e) {
                    console.error("Error adding ice candidate: ", e);
                }
            }
        }, "sipclient_new_ice_candidate_event");

        this.hass.connection.subscribeEvents((event) => {
            // call ended
            console.log("call ended event", event);
            this.pc.close();
            this.pc = null;
            this.call_id = "";
            this.requestUpdate();
        }, "sipclient_call_ended_event");
    }

    create_pc() {
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
            this.requestUpdate();
        }

        pc.ontrack = (event) => {
            console.log("ontrack", event);
            const audio = this.renderRoot.querySelector("#audio");
            audio.srcObject = event.streams[0];
        }

        pc.onicecandidate = async (event) => {
            if (event.candidate) {
                console.log("sending ICE candidate");

                // wait until this.call_id is set
                // while (!this.call_id) {
                //     console.log("waiting for call_id to be set");
                //     await new Promise(r => setTimeout(r, 1000));
                // }
                console.log("IMPORTANT: this.call_id: ", this.call_id);

                this.hass.connection.sendMessagePromise({
                    type: "fire_event",
                    event_type: "sipclient_new_ice_candidate_event",
                    event_data: {
                        call_id: "test", //this.call_id,
                        candidate: event.candidate,
                        for: "integration",
                    },
                });
            }
            console.log("onicecandidate", event);
        };

        return pc;
    }

    async add_media() {
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

    async start_call() {
        console.log("call clicked!");
        this.pc = this.create_pc();
        await this.add_media();

        this.pc.createOffer().then((offer) => {
            return this.pc.setLocalDescription(offer);
        }).then(() => {
            return new Promise((resolve) => {
                if (this.pc.iceGatheringState === "complete") {
                    resolve();
                } else {
                    this.pc.onicecandidate = (event) => {
                        if (event.candidate === null) {
                            resolve();
                        }
                    };
                }
            });
        }).then(() => {
            const offer = this.pc.localDescription;
        
            this.hass.connection.sendMessagePromise({
                type: "fire_event",
                event_type: "sipclient_start_call_event",
                event_data: {
                    sdp: offer.sdp,
                    caller: {
                        "name": "test",
                        "number": "1000", // TODO: get from config
                    },
                    callee: {
                        "name": "",
                        "number": "008",
                    },
                    sdp: offer.sdp,
                }
            }).then(
                (resp) => {
                    console.log("Message start_call success!", resp.result);
                },
                (err) => {
                    console.log("Message start_call failed!", err);
                }
            );
        });
    }

    async deny_call() {
        console.log("deny clicked!");
        console.log("callID: " + this.call_id)
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_deny_call_event",
            event_data: {
                call_id: this.call_id,
                callee: {
                    "name": "test",
                    "number": "1000",
                },
                caller: {
                    "name": "",
                    "number": "008",
                },
            }
        }).then(
            (resp) => {
                console.log("Message success!", resp.result);
            },
            (err) => {
                console.log("Message failed!", err);
            }
        );
    }

    async end_call() {
        console.log("end clicked!");
        console.log("callID: " + this.call_id)
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_end_call_event",
            event_data: {
                call_id: this.call_id,
                callee: {
                    "name": "test",
                    "number": "1000",
                },
                caller: {
                    "name": "",
                    "number": "008",
                },
                reason: "user ended call",
            }
        }).then(
            (resp) => {
                console.log("Message end_call success!", resp.result);
            },
            (err) => {
                console.log("Message end_call failed!", err);
            }
        );
    }

    async answer_call() {
        console.log("answer clicked!");
        console.log("callID: " + this.call_id);

        await this.add_media();

        this.pc.createAnswer().then((answer) => {
            return this.pc.setLocalDescription(answer);
        }).then(() => {
            return new Promise((resolve) => {
                if (this.pc.iceGatheringState === "complete") {
                    resolve();
                } else {
                    this.pc.onicecandidate = (event) => {
                        if (event.candidate === null) {
                            resolve();
                        }
                    };
                }
            });
        }).then(() => {
            const answer = this.pc.localDescription;
        
            this.hass.connection.sendMessagePromise({
                type: "fire_event",
                event_type: "sipclient_answer_call_event",
                event_data: {
                    call_id: this.call_id,
                    sdp: answer.sdp,
                }
            }).then(
                (resp) => {
                    console.log("Message success!", resp.result);
                },
                (err) => {
                    console.log("Message failed!", err);
                }
            );
        });
    }
}

customElements.define("test-card", ContentCardExample);

window.customCards = window.customCards || [];
window.customCards.push({
    type: "test-card",
    name: "Test Card",
    preview: true,
    description: "Card just for testing!"
});

