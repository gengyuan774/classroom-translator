class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Int16Array(2400); this.index = 0; this.enabled = true;
    this.port.onmessage = ({data}) => {
      if (data === 'flush') {
        if(this.index) this.port.postMessage({audio:this.buffer.slice(0,this.index).buffer});
        this.index=0; this.enabled=false; this.port.postMessage({flushed:true});
      }
      if(data === 'resume') this.enabled=true;
    };
  }
  process(inputs) {
    const input=inputs[0]?.[0]; if (!input || !this.enabled) return true;
    // AudioContext is explicitly created at 24 kHz; the browser resamples the microphone.
    for(const sample of input){
      this.buffer[this.index++]=Math.max(-32768,Math.min(32767,Math.round(sample*32768)));
      if(this.index===2400){this.port.postMessage({audio:this.buffer.buffer},[this.buffer.buffer]);this.buffer=new Int16Array(2400);this.index=0;}
    }
    return true;
  }
}
registerProcessor('pcm-capture',PcmCapture);
