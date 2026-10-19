import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexCompanyProfile } from "./prepare.js";

const backendDirectory = fileURLToPath(new URL(".", import.meta.url));
const profilePath = resolve(backendDirectory, "FISEN_Company_Profile_Detailed.pdf");

try {
    await indexCompanyProfile(profilePath);
} catch (error) {
    console.error("Document indexing failed:", error);
    process.exitCode = 1;
}