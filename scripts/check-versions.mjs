import { readFile } from "node:fs/promises";

const [packageJson, manifest, versions] = await Promise.all(
  ["package.json", "manifest.json", "versions.json"].map(async (path) =>
    JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
  ),
);

const expected = manifest.version;
const errors = [];
if (packageJson.version !== expected) {
  errors.push(
    `package.json is ${packageJson.version}, but manifest.json is ${expected}`,
  );
}
if (versions[expected] !== manifest.minAppVersion) {
  errors.push(
    `versions.json[${JSON.stringify(expected)}] must equal manifest minAppVersion ` +
      `${JSON.stringify(manifest.minAppVersion)}`,
  );
}

const tag = process.env.RELEASE_TAG?.replace(/^v/, "");
if (tag && tag !== expected) {
  errors.push(
    `release tag ${process.env.RELEASE_TAG} does not match ${expected}`,
  );
}

if (errors.length) {
  console.error(`Version check failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Version metadata is consistent (${expected}).`);
}
