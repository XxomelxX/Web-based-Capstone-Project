const fs=require('fs');
const c=fs.readFileSync(process.argv[2],'utf8');
const i=c.indexOf('not supported');
console.log(c.slice(i-1200,i+400));
