## 1. Solidity Dependencies

- [x] 1.1 Add `@oasisprotocol/sapphire-contracts` to `contracts/package.json` and install

## 2. Contract Changes

- [x] 2.1 Add `EthereumUtils` and `EIP155Signer` imports to `FdcAccounting.sol`
- [x] 2.2 Add encumbered wallet state (`encumberedAddress`, `encumberedSecretKey`) and generate keypair in constructor
- [x] 2.3 Add `getDepositAddress()` view function
- [x] 2.4 Add `receivingAddress` parameter to `creditDeposit` with `InvalidReceivingAddress` validation
- [x] 2.5 Add `signWithdrawal()` function with balance debit and `EIP155Signer.sign()` call
- [x] 2.6 Add new errors (`InsufficientBalance`, `InvalidReceivingAddress`) and `WithdrawalSigned` event
- [x] 2.7 Recompile contract with `npx hardhat compile`

## 3. Demo Flow Changes

- [x] 3.1 Reorder main flow: deploy contract before sending Sepolia deposit
- [x] 3.2 Add step to query deposit address from contract via `getDepositAddress()`
- [x] 3.3 Update `sendSepoliaDeposit` to send ETH to the deposit address (not to self)
- [x] 3.4 Update `relayToSapphire` to pass `receivingAddress` as 4th arg to `creditDeposit`
- [x] 3.5 Add `signAndBroadcastWithdrawal` function: staticCall to get signed bytes, real call to debit, broadcast to Sepolia
- [x] 3.6 Wire up withdrawal step in `main()` with gas cost calculation

## 4. Documentation & Verification

- [x] 4.1 Update `README.md` with new flow, deposit address explanation, and withdrawal step
- [x] 4.2 Type-check with `npx tsc --noEmit`
- [x] 4.3 Run full e2e: deploy → get deposit addr → deposit → attest → verify → credit → withdraw
