import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  // Deployment script: initialize_registry must be called after program deploy.
  // See docs/adr-001-crypto-fork.md for authority requirements.
};
