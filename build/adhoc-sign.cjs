// electron-builder leaves the app unsigned when there is no Developer ID certificate. Apple Silicon Macs report
// unsigned downloads as "damaged", so such builds get an ad-hoc signature: they then open with right-click → Open.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  try {
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "ignore" });
    return; // already properly signed
  } catch {
    /* unsigned */
  }
  console.log("  • no signing certificate: ad-hoc signing", path.basename(app));
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--options", "runtime", "--entitlements", path.join(__dirname, "entitlements.mac.plist"), app], { stdio: "inherit" });
};
