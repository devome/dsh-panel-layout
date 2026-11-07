/**
 * Manifest checks — no dependency, no DOM.
 *
 * Run: node test/manifest.mjs
 *
 * Pins the contract the Host reads before any browser code runs: the package
 * name, the `dsh.client` declaration, the exported paths the Loader resolves,
 * the files a packed bundle would ship, and the display resources. A bundle
 * that fails here fails at install time in the profile, which is far more
 * expensive to diagnose.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let checks = 0;

function check(description, condition, detail = "") {
	checks += 1;
	if (condition) console.log(`  ok  ${description}`);
	else {
		failures.push(description);
		console.error(`fail  ${description} ${detail}`);
	}
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

check("package name is dsh-panel-layout", manifest.name === "dsh-panel-layout", manifest.name);
check("version is a release version", /^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version);
check("package is an ES module", manifest.type === "module", manifest.type);
check("bundle declares exactly one patch", manifest.dsh?.bundle?.patch === "./cordis.patch.yml");
check("client half targets the web platform", manifest.dsh?.client?.platform === "web");
check(
	"client half declares no immediate mount (the shell owns the order)",
	manifest.dsh?.client?.immediately === undefined,
	JSON.stringify(manifest.dsh?.client?.immediately),
);
check("no runtime dependencies", manifest.dependencies === undefined);
check("react is an optional peer", manifest.peerDependencies?.react !== undefined && manifest.peerDependenciesMeta?.react?.optional === true);
check("node engines allow the shipped runtime", />=22/.test(manifest.engines?.node ?? ""), manifest.engines?.node);
check("dsh engines pin a compatible release", (manifest.engines?.dsh ?? "").startsWith("^0.2."), manifest.engines?.dsh);

for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
	if (!subpath.startsWith("./")) continue;
	if (subpath.includes("*")) continue;
	const path = join(root, target.default ?? target);
	check(`exports "${subpath}" resolves to a file`, existsSync(path), path);
}

const patch = readFileSync(join(root, "cordis.patch.yml"), "utf8");
check("patch inserts one row", (patch.match(/- id:/g) ?? []).length === 1);
check("patch row uses the full package name", patch.includes("name: dsh-panel-layout"), patch.trim());

const clientSource = readFileSync(join(root, "lib", "client.js"), "utf8");
check("client bundle registers under the package id", clientSource.includes('id: "dsh-panel-layout"'));
check("client bundle never imports a Harness Client package", !/require\("@deepseek-ai\//.test(clientSource));
check("client bundle registers the General settings row", clientSource.includes('"settings.general.item"'));
check("client bundle registers More-menu rows", clientSource.includes('"sidebar.panellist.actions"'));
check("client bundle styles only with theme tokens", !/(^|[\s:])#[0-9a-fA-F]{3,6}\b/.test(clientSource.replace(/#region[\s\S]*?(?=\n\s*\/\/#region)/g, "")));

const files = manifest.files ?? [];
for (const required of ["lib/index.js", "lib/client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"]) {
	check(`files includes ${required}`, files.includes(required), JSON.stringify(files));
}

for (const locale of ["en.json", "zh.json"]) {
	const path = join(root, "locale", locale);
	check(`locale/${locale} exists`, existsSync(path), path);
	if (!existsSync(path)) continue;
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	check(`locale/${locale} has meta.title`, typeof parsed.meta?.title === "string" && parsed.meta.title !== "", JSON.stringify(parsed.meta));
	check(`locale/${locale} has meta.description`, typeof parsed.meta?.description === "string" && parsed.meta.description !== "");
}

/* Both READMEs ship, and each links the other: the Chinese file is the
   default one a visitor lands on, the English one is the translation. */
for (const name of ["README.md", "README.en.md"]) {
	const path = join(root, name);
	check(`${name} exists`, existsSync(path), path);
	check(`files includes ${name}`, files.includes(name), JSON.stringify(files));
	if (!existsSync(path)) continue;
	const text = readFileSync(path, "utf8");
	check(`${name} starts with a level-one title`, /^# dsh-panel-layout\s*$/m.test(text.split("\n")[0]));
	const other = name === "README.md" ? "README.en.md" : "README.md";
	check(`${name} links ${other}`, text.includes(`](${other})`), other);
}

/* The licence is MIT, and the file has to agree with the manifest: npm and
   most registries read one from `license` and the other from the file. */
const licensePath = join(root, "LICENSE");
check("LICENSE exists", existsSync(licensePath), licensePath);
check("package.json declares MIT", manifest.license === "MIT", String(manifest.license));
check("files includes LICENSE", files.includes("LICENSE"), JSON.stringify(files));
if (existsSync(licensePath)) {
	const license = readFileSync(licensePath, "utf8");
	check("LICENSE is the MIT text", license.startsWith("MIT License") && license.includes("Permission is hereby granted, free of charge"));
	check("LICENSE carries a copyright holder", /Copyright \(C\) \d{4} \S/.test(license));
}

const icon = join(root, "icon.svg");
check("icon exists", existsSync(icon), icon);
if (existsSync(icon)) {
	const size = statSync(icon).size;
	check("icon is under the 256 KiB limit", size <= 256 * 1024, `${size} bytes`);
	const svg = readFileSync(icon, "utf8");
	check("icon is an SVG document", /^<svg[\s>]/.test(svg.trim()), svg.slice(0, 40));
	check("icon carries no external reference", !/(href|xlink:href|url\()/.test(svg));
}

console.log(failures.length === 0 ? `\n${checks} checks passed` : `\n${failures.length} of ${checks} checks failed`);
process.exit(failures.length === 0 ? 0 : 1);
