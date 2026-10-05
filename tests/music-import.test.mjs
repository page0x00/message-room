import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readID3,readTrackInfo,inspectLyrics} from '../music-import-core.js';
function tag(version,frames){const parts=frames.map(([id,text])=>{const data=Buffer.from('\x03'+text),header=Buffer.alloc(10);header.write(id);header.writeUInt32BE(data.length,4);return Buffer.concat([header,data]);}),body=Buffer.concat(parts),header=Buffer.from([73,68,51,version,0,0,0,0,body.length>>7,body.length&127]);return Buffer.concat([header,body]);}
test('bounded ID3 reader handles v2.3/v2.4 text and rejects truncated or compressed tags',async()=>{
 for(const version of [3,4]){const bytes=tag(version,[['TIT2','标题'],['TPE1','演奏者'],['TALB','专辑']]);assert.deepEqual(readID3(bytes),{name:'标题',artist:'演奏者',album:'专辑'});assert.deepEqual(readID3(bytes.subarray(0,18)),{});const unsupported=Buffer.from(bytes);unsupported[5]=128;assert.deepEqual(readID3(unsupported),{});}
 const file=new File(['not an ID3 file'],'Artist - Song.wav',{type:'audio/wav'});assert.deepEqual(await readTrackInfo(file),{artist:'Artist',name:'Song'});
});
test('lyric validation preserves untimed text and reports ordering, duplicate and duration problems',()=>{
 const plain=inspectLyrics('第一行\n第二行');assert.deepEqual(plain.lyrics,[]);assert.equal(plain.plainLyrics,'第一行\n第二行');
 const timed=inspectLyrics('[00:08]后\n[00:02]前\n[00:02]重复\n[01:00]超出',10);assert.equal(timed.warnings.length,3);assert.equal(timed.plainLyrics,'');assert.deepEqual(timed.lyrics.map(l=>l.time),[2,2,8,60]);
 assert.equal(inspectLyrics('').message,'还没有添加歌词');
});
