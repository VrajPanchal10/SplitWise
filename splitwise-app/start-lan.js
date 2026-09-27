const { execSync, spawn } = require("child_process");

function getLocalIPv4() {
  const output = execSync("ipconfig", { encoding: "utf8" });

  const matches = output.match(
    /IPv4 Address[.\s]*:\s*(\d+\.\d+\.\d+\.\d+)/gi
  );

  if (!matches || matches.length === 0) {
    throw new Error("Could not detect a local IPv4 address.");
  }

  const ips = matches
    .map((line) => line.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1])
    .filter(Boolean)
    .filter((ip) => !ip.startsWith("127."));

  if (ips.length === 0) {
    throw new Error("Could not find a usable IPv4 address.");
  }

  return ips[0];
}

const ip = getLocalIPv4();
const apiUrl = `http://${ip}:8080/api`;

console.log("");
console.log("========================================");
console.log(" SplitWise LAN Development");
console.log("========================================");
console.log(` Laptop IPv4 : ${ip}`);
console.log(` API URL     : ${apiUrl}`);
console.log("========================================");
console.log("");

const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: apiUrl,
};

// Use Windows CMD so Expo receives a real interactive terminal.
// This allows Expo to display its QR code normally.
const expo = spawn(
  "cmd.exe",
  ["/d", "/s", "/c", "npx expo start --lan"],
  {
    stdio: "inherit",
    env,
    windowsHide: false,
  }
);

expo.on("error", (error) => {
  console.error("Failed to start Expo:", error);
  process.exit(1);
});

expo.on("exit", (code) => {
  process.exit(code ?? 0);
});