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

/* The host gate (dsh-app-boot `unmetRequirements`) reads `engines.dsh` alone
   and satisfies it with `includePrerelease: true`; the market reads the same
   field. A plain caret on a prerelease baseline (`^0.2.0-rc.1`) passes both of
   those but silently drops every later prerelease under the default
   npm-semver rule, so the range has to name its prerelease branches. The
   floor is the first release whose `dsh-client-ui-sidebar` exposes
   `sidebar.panellist.actions` and the `aria-haspopup` More launcher — without
   them the overflow rows have nowhere to go. */
const dshRange = manifest.engines?.dsh ?? "";
check("dsh engines start at the first release with the More contract", /(^|\|\|)\s*\^0\.2\.1-rc\.3(\s|$)/.test(dshRange), dshRange);
check("dsh engines cover the 0.2.2 prereleases", /\^0\.2\.2-0(\s|$)/.test(dshRange), dshRange);
check("dsh engines exclude the pre-contract 0.2.0 series", !/\^0\.2\.0/.test(dshRange), dshRange);
check("dsh engines exclude 0.3 and later", !/<1\.0/.test(dshRange) && !/\^1\./.test(dshRange), dshRange);
check(
	"dsh engines agree with the declared compatibility",
	manifest.dsh?.compatibility?.dsh === dshRange,
	String(manifest.dsh?.compatibility?.dsh),
);

/* `dsh.compatibility.dshReleases` is self-description — no host or market code
   reads it — so its only job is to stay honest: the releases it lists must be
   the ones the range above actually admits. */
const releases = Object.entries(manifest.dsh?.compatibility?.dshReleases ?? {});
check("the compatibility list is not empty", releases.length > 0, String(releases.length));
for (const [version, verdict] of releases) {
	check(`release ${version} is marked compatible`, verdict === "compatible", String(verdict));
	check(`release ${version} looks like a 0.2 release`, /^0\.2\.\d+(-[a-z]+\.\d+)?$/.test(version), version);
}
const floor = dshRange.match(/0\.2\.\d+-rc\.\d+/)?.[0] ?? "";
check("the compatibility list starts at the engine floor", floor !== "" && releases.some(([version]) => version === floor), `${floor} in ${JSON.stringify(releases.map(([v]) => v))}`);

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

/* The tarball carries the shipped half and the documents, nothing else. The
   tests read the repository, not the package: a consumer installing this from
   npm has no use for them, and they are the only files that would grow a
   dependency on the checkout. */
check("the tests are not shipped", !files.some((entry) => entry.startsWith("test")), JSON.stringify(files));
check("screenshots.json is not shipped", !files.includes("screenshots.json"), JSON.stringify(files));
check("files lists every shipped locale", files.includes("locale/*.json"), JSON.stringify(files));

/* Registry metadata: npm shows these on the package page, and the market
   resolves our entry back to this repository through `repository`, so a wrong
   URL is a broken listing rather than a cosmetic slip. */
const repo = "https://github.com/devome/dsh-panel-layout";
check("repository points at this repository", manifest.repository?.url === `git+${repo}.git`, JSON.stringify(manifest.repository));
check("repository declares the git type", manifest.repository?.type === "git", String(manifest.repository?.type));
check("homepage is the README of this repository", manifest.homepage === `${repo}#readme`, String(manifest.homepage));
check("bugs points at the issue tracker", manifest.bugs?.url === `${repo}/issues`, JSON.stringify(manifest.bugs));
check("author is a name with an address", /^\S.* <[^@\s]+@[^@\s]+>$/.test(manifest.author ?? ""), String(manifest.author));
check("publishConfig publishes publicly", manifest.publishConfig?.access === "public", JSON.stringify(manifest.publishConfig));
check("keywords carry the market tag", (manifest.keywords ?? []).includes("dsh-plugin"), JSON.stringify(manifest.keywords));

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
	/* The install line is the one command a reader copies, and after publishing
	   to npm the package name is the shortest thing that works. A README that
	   still tells them to clone is a README that sends them somewhere else for
	   no reason. */
	check(`${name} installs by the npm package name`, text.includes(`add ${manifest.name}`), manifest.name);
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
	const address = manifest.author?.match(/<([^>]+)>/)?.[1];
	check("LICENSE names the manifest author", address !== undefined && license.includes(address), `${address}`);
}

/* Every image a README shows is hosted, not checked in: a relative path
   renders on GitHub and breaks on npmjs, where the README has no repository to
   resolve against. Absolute URLs render in both places and keep the tarball
   small, so a relative path here is a failure rather than a preference. */
const readmes = ["README.md", "README.en.md"];
const referenced = new Set();
for (const name of readmes) {
	const text = readFileSync(join(root, name), "utf8");
	for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) referenced.add(match[1]);
}
check("the READMEs show screenshots", referenced.size > 0, `${referenced.size} images`);
for (const target of referenced) {
	check(`image ${target} is an absolute URL`, /^https:\/\//.test(target), target);
}
check("no screenshot is checked in", !existsSync(join(root, "screenshots")), "screenshots/ still present");
check("no screenshot is shipped", !files.some((entry) => entry.startsWith("screenshots")), JSON.stringify(files));

/* The market reads `screenshots.json` from the repository at HEAD — not from
   the tarball — so this file exists to order and cap the gallery. It repeats
   the README's URLs on purpose: the README is what a human reads, the JSON is
   what the market reads, and a mismatch means the listing shows a picture the
   documentation does not. */
const shotsPath = join(root, "screenshots.json");
check("screenshots.json exists", existsSync(shotsPath), shotsPath);
if (existsSync(shotsPath)) {
	let shots = null;
	try {
		shots = JSON.parse(readFileSync(shotsPath, "utf8"));
	} catch (error) {
		check("screenshots.json is valid JSON", false, error.message);
	}
	if (shots !== null) {
		check("screenshots.json is an array", Array.isArray(shots), typeof shots);
		const list = Array.isArray(shots) ? shots : [];
		check("screenshots.json declares between 1 and 8 images", list.length >= 1 && list.length <= 8, `${list.length} images`);
		const hosts = new Set(["raw.githubusercontent.com", "user-images.githubusercontent.com", "camo.githubusercontent.com", "github.com"]);
		for (const shot of list) {
			let url = null;
			try {
				url = new URL(shot);
			} catch {
				check(`screenshot ${shot} is an absolute URL`, false);
				continue;
			}
			check(`screenshot ${shot} is https on GitHub hosting`, url.protocol === "https:" && hosts.has(url.hostname), url.hostname);
			check(`screenshot ${shot} is not an SVG`, !/\.svg($|\?)/i.test(url.pathname), url.pathname);
			check(`screenshot ${shot} appears in the README`, referenced.has(shot), "not referenced");
		}
		check("screenshots.json lists no duplicates", new Set(list).size === list.length, `${new Set(list).size} of ${list.length}`);
	}
}
for (const name of readmes) {
	const text = readFileSync(join(root, name), "utf8");
	const videoAt = text.indexOf("user-attachments");
	const shotAt = text.search(/!\[/);
	check(`${name} shows the demo before the gallery`, videoAt !== -1 && shotAt > videoAt, `${videoAt} vs ${shotAt}`);
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
