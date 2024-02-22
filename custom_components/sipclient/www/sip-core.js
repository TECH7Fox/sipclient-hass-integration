import {
    LitElement,
    html,
    css,
} from "https://unpkg.com/lit-element@2.0.1/lit-element.js?module";

const version = "0.1.6";

console.info(
    `%c SIP-CORE %c ${version} `,
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
        const ice_gatering_state = this.pc ? this.pc.iceGatheringState : "unavailable";
        const ice_connection_state = this.pc ? this.pc.iceConnectionState : "unavailable";
        return html`
            <ha-card header="SIP Core test ${version}">
                call_id: ${this.call_id}
                <br>
                connection_state: ${connection_state}
                <br>
                ice_gathering: ${ice_gatering_state}
                <br>
                ice_connection: ${ice_connection_state}
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
        this.hass.connection.subscribeEvents(async (event) => {
            console.log("incoming call event", event);
            this.call_id = event.data.call_id;
            this.pc = this.create_pc();
            const offer = new RTCSessionDescription({sdp: event.data.sdp, type: "offer"})
            await this.pc.setRemoteDescription(offer);
            console.log("incoming offer sdp: ", event.data.sdp);
            this.requestUpdate();
            // TODO: trigger display of answer button
        }, "sipclient_incoming_call_event");

        this.hass.connection.subscribeEvents(async (event) => {
            console.log("outgoing call event", event);
            this.call_id = event.data.call_id;
            const answer = new RTCSessionDescription({sdp: event.data.sdp, type: "answer"})
            await this.pc.setRemoteDescription(answer);
            console.log("incoming answer sdp: ", event.data.sdp);
            this.requestUpdate();
        }, "sipclient_outgoing_call_event");

        this.hass.connection.subscribeEvents((event) => {
            console.log("call ended event", event);
            this.pc.close();
            this.pc = null;
            this.call_id = "";
            this.requestUpdate();
        }, "sipclient_call_ended_event");

        // seek for existing calls by calling seek_call_event
        this.hass.connection.sendMessagePromise({
            type: "fire_event",
            event_type: "sipclient_seek_call_event",
            event_data: {
                number: "1000",
            },
        });
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

        pc.onicegatheringstatechange = (event) => {
            console.log("onicegatheringstatechange", event);
            this.requestUpdate();
        }

        pc.oniceconnectionstatechange = (event) => {
            console.log("oniceconnectionstatechange", event);
            this.requestUpdate();
        }

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

    wait_for_ice_gathering_complete() {
        return new Promise((resolve) => {
            if (this.pc.iceGatheringState === "complete") {
                resolve();
            } else {
                const timeout = setTimeout(() => {
                    resolve();
                }, 60000); // TODO: Configurable timeout
                this.pc.onicecandidate = (event) => {
                    if (event.candidate === null) {
                        clearTimeout(timeout);
                        resolve();
                    }
                };
            }
        });
    }

    async start_call() {
        console.log("call clicked!");
        this.pc = this.create_pc();
        await this.add_media();

        this.pc.createOffer().then((offer) => {
            return this.pc.setLocalDescription(offer);
        }).then(
            this.wait_for_ice_gathering_complete.bind(this)
        ).then(() => {
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
            });
        });
    }

    async deny_call() {
        console.log("deny clicked!");
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
        });
    }

    async end_call() {
        console.log("end clicked!");
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
        });
    }

    async answer_call() {
        console.log("answer clicked!");
        await this.add_media();
        this.pc.createAnswer().then((answer) => {
            return this.pc.setLocalDescription(answer);
        }).then(
            this.wait_for_ice_gathering_complete.bind(this)
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

customElements.define("test-card", ContentCardExample);

window.customCards = window.customCards || [];
window.customCards.push({
    type: "test-card",
    name: "Test Card",
    preview: true,
    description: "Card just for testing!"
});

