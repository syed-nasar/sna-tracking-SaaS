
require("dotenv").config();

const app = require("./app");

const PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";

app.listen(PORT, HOST, () => {
  console.log(
    `SNA Fleet backend running at http://${HOST}:${PORT}`
  );
});
