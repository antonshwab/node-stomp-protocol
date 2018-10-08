import { StompFrameLayer } from "./frame";
import { StompFrame, StompError } from "./model";
import { clearInterval } from "timers";

export interface IHeartbeatOptions {
    outgoingPeriod: number;
    incomingPeriod: number;
}

export class Heartbeat {

    public static defaultOptions: IHeartbeatOptions = { outgoingPeriod: 0, incomingPeriod: 0 };

    options: IHeartbeatOptions;
    optionsString: string;

    incomingPeriod?: number;
    outgoingPeriod?: number;

    lastIncoming: number = 0;

    incomingTimer?: NodeJS.Timer;
    outgoingTimer?: NodeJS.Timer;

    constructor(
        private readonly frameLayer: StompFrameLayer,
        options: IHeartbeatOptions = Heartbeat.defaultOptions) {

        this.options = options;
        this.optionsString = `${this.options.outgoingPeriod},${this.options.incomingPeriod}`;

        this.frameLayer.emitter.on("frame", (frame) => this.onFrame(frame));
        this.frameLayer.stream.emitter.on("data", (data) => this.onData(data));

        this.frameLayer.stream.emitter.on("end", () => {
            this.releaseTimers()
        });

        this.frameLayer.emitter.on("end", () => {
            this.releaseTimers()
        });

        this.frameLayer.emitter.on("error", () => {
            this.releaseTimers()
        });
    }

    onData(data: string) {
        this.lastIncoming = Date.now();
    }

    onFrame(frame: StompFrame) {
        if (frame.command === "CONNECT" || frame.command === "CONNECTED") {
            const heartbeat = frame.headers["heart-beat"];
            if (!heartbeat) {
                return;
            }

            this.init(heartbeat);
        }

        this.lastIncoming = Date.now();
    }

    init(heartbeat: string) {
        const [remoteOutgoingPeriod, remoteIncomingPeriod] = heartbeat.split(",").map(s => Number(s));

        const localIncomingPeriod = this.options.incomingPeriod;
        if (localIncomingPeriod > 0 && remoteOutgoingPeriod > 0) {
            this.incomingPeriod = Math.max(localIncomingPeriod, remoteOutgoingPeriod);
            this.setupIncomingTimer();
        }

        const localOutgoingPeriod = this.options.outgoingPeriod;
        if (localOutgoingPeriod > 0 && remoteIncomingPeriod > 0) {
            this.outgoingPeriod = Math.max(localOutgoingPeriod, remoteIncomingPeriod);
            this.setupOutgoingTimer();
        }
    }

    setupOutgoingTimer() {
        const period = this.outgoingPeriod;
        if (period && period > 0) {
            this.outgoingTimer = setInterval(() => {
                const eol = "\0";
                this.frameLayer.stream.send(eol);
            }, period);
        }
    }

    resetupOutgoingTimer() {
        this.releaseTimer(this.outgoingTimer);
        this.setupOutgoingTimer();
    }

    releaseTimer(timer?: NodeJS.Timer) {
        timer && clearInterval(timer);
    }

    releaseTimers() {
        this.releaseTimer(this.incomingTimer);
        this.releaseTimer(this.outgoingTimer);
    }

    setupIncomingTimer() {
        const period = this.incomingPeriod;
        if (period && period > 0) {
            this.incomingTimer = setInterval(() => {
                const delta = Date.now() - this.lastIncoming;
                if (delta > 2 * period && this.lastIncoming > 0) {
                    this.frameLayer.close();
                    this.frameLayer.error(new StompError(`No heartbeat for the last 2*${period} ms`));
                }
            }, period);
        }
    }

}
