// Audio Manager
export class AudioController {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.assets = {};
        this.enabled = false;
    }

    async load() {
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        
        const files = {
            'hit': 'hit.mp3',
            'miss': 'miss.mp3',
            'ping': 'ping.mp3',
            'win': 'win.mp3'
        };

        for (const [name, url] of Object.entries(files)) {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.assets[name] = audioBuffer;
        }
        this.enabled = true;
    }

    play(name, vol = 1.0, pitch = 1.0) {
        if (!this.enabled || !this.assets[name]) return;
        
        const source = this.ctx.createBufferSource();
        source.buffer = this.assets[name];
        
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = vol;

        source.playbackRate.value = pitch;

        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        source.start(0);
    }

    // Synthesize a vibration-like drone for proximity
    startDrone() {
        if (!this.enabled) return;
        this.osc = this.ctx.createOscillator();
        this.oscGain = this.ctx.createGain();
        
        this.osc.type = 'sine';
        this.osc.frequency.value = 50;
        this.oscGain.gain.value = 0;
        
        this.osc.connect(this.oscGain);
        this.oscGain.connect(this.ctx.destination);
        this.osc.start();
    }

    setDroneIntensity(intensity) {
        // intensity 0 to 1
        if (!this.oscGain) return;
        
        const now = this.ctx.currentTime;
        this.oscGain.gain.cancelScheduledValues(now);
        this.oscGain.gain.linearRampToValueAtTime(intensity * 0.5, now + 0.1);
        
        this.osc.frequency.cancelScheduledValues(now);
        this.osc.frequency.linearRampToValueAtTime(50 + (intensity * 100), now + 0.1);
    }

    stopDrone() {
        if (this.osc) {
            this.osc.stop();
            this.osc.disconnect();
            this.osc = null;
        }
    }
}