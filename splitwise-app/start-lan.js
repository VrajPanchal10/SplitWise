const { execSync, spawn } = require("child_process");

function getLocalIPv4() {
  const output = execSync("ipconfig", { encoding: "utf8" });

  const blocks = output.split(/\r?\n\r?\n/);
  const candidates = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const header = lines[0] || "";

    if (/Media disconnected/i.test(block)) continue;
    if (/vEthernet|VirtualBox|VMware|Loopback/i.test(header)) continue;

    const ipv4Match = block.match(/IPv4 Address[.\s]*:\s*(\d+\.\d+\.\d+\.\d+)/i);
    const gatewayMatch = block.match(/Default Gateway[.\s]*:\s*(\S+)/i);
    const hasGateway = !!(gatewayMatch && gatewayMatch[1] && gatewayMatch[1] !== "");

    if (ipv4Match) {
      const ip = ipv4Match[1];
      if (!ip.startsWith("127.")) {
        candidates.push({
          ip,
          header,
          hasGateway,
          isWifi: /Wi-Fi|Wireless/i.test(header),
          isHotspot: /Local Area Connection\*/i.test(header) || ip.startsWith("192.168.137."),
        });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.hasGateway !== b.hasGateway) return b.hasGateway ? 1 : -1;
    if (a.isHotspot !== b.isHotspot) return a.isHotspot ? 1 : -1;
    if (a.isWifi !== b.isWifi) return b.isWifi ? 1 : -1;
    return 0;
  });

  if (candidates.length > 0) {
    return candidates[0].ip;
  }

  throw new Error("Could not detect a usable local IPv4 address.");
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