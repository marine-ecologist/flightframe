import test from 'node:test';
import assert from 'node:assert/strict';
import {readTextFile} from '../public/local-files.js';
test('reads SRT normally without constructing fallback reader',async()=>{
 class Unexpected{constructor(){throw new Error('fallback should not run');}}
 assert.equal(await readTextFile({text:async()=> '1\n00:00:00,000 --> 00:00:01,000'},Unexpected),'1\n00:00:00,000 --> 00:00:01,000');
});
test('falls back to FileReader when Blob.text fails and surfaces access errors',async()=>{
 const io=new Error('The I/O read operation failed.');const file={text:async()=>{throw io;}};
 class Working{readAsText(value){assert.equal(value,file);this.result='telemetry';this.onload();}}
 assert.equal(await readTextFile(file,Working),'telemetry');
 class Broken{readAsText(){this.error=io;this.onerror();}}
 await assert.rejects(readTextFile(file,Broken),/I\/O/);
});
