const { compileAll, findMatches } = require("./matcher");

const text = "feature that’s new is the eSIM and it’s completely lock";
const cfg = {
  categories: [{ id:"p", name:"PRF", enabled:true, color:"#", fColor:"#", words:["f*ck"] }],
  ignoreList: []
};

const out = findMatches(text, compileAll(cfg));
console.log(out);
if (out.length !== 0) {
  console.error("FAIL: expected []");
  process.exit(1);
}
console.log("PASS");
