import { SolanaAuthorityOrchestrator } from "./src/solanaAuthorityOrchestrator";
require("dotenv").config();

const main = async () => {   
  const orchestrator = new SolanaAuthorityOrchestrator(
    process.env.CURRENT_AUTHORITY_VAULT_ID || "",
    process.env.NEW_AUTHORITY_VAULT_ID || "",
  );

  await orchestrator.changeAuthorities()
}

main().then(() => {
  console.log("Change authorities process completed successfully.");
}
).catch((error) => {
  console.error("Error during change authorities process:", error);
}
);