import { SolanaAuthorityOrchestrator } from "./src/solanaAuthorityOrchestrator";
require("dotenv").config();

const main = async () => {   
  const orchestrator = new SolanaAuthorityOrchestrator(
    process.env.CURRENT_AUTHORITY_VAULT_ID || "",
    process.env.NEW_AUTHORITY_VAULT_ID || "",
  );
  
  const operation = process.env.OPERATION || "change-authority";
  
  if(operation == "change-authority") {
  await orchestrator.changeAuthorities()
  } else if (operation == "withdraw") {
    await orchestrator.withdrawFromInactiveAccounts();
  } else {
    throw new Error("Invalid operation specified. Use 'change-authority' or 'withdraw'.");
  }
}

main().then(() => {
  console.log("Process completed successfully.");
}
).catch((error) => {
  console.error("Error during process:", error);
}
);