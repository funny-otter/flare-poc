## 1. Dependencies

- [x] 1.1 Install `@oasisprotocol/sapphire-contracts` and `@oasisprotocol/sapphire-ethers-v6`

## 2. Contract Changes

- [x] 2.1 Add `EthereumUtils` and `EIP155Signer` imports
- [x] 2.2 Replace `depositAddress` with `encumberedWalletAddr`, `encumberedWalletKey`, `withdrawalChainId`, `encumberedWalletNonce`
- [x] 2.3 Update constructor: `(address, uint256)`, generate keypair with `EthereumUtils.generateKeypair()`
- [x] 2.4 Update `verifyAndCredit` to use `encumberedWalletAddr` instead of `depositAddress`
- [x] 2.5 Add `getDepositAddress()` view function
- [x] 2.6 Add `WithdrawalSigned` event
- [x] 2.7 Implement `withdraw(to, amount, gasPrice, gasLimit)` — balance deduction, EIP-155 tx building + signing, nonce increment, event emission

## 3. Deploy Script

- [x] 3.1 Remove `DEPOSIT_ADDRESS` env var requirement
- [x] 3.2 Wrap signer with `wrapEthersSigner`
- [x] 3.3 Update constructor args to `(signer.address, 11155111n)`
- [x] 3.4 Read and log `encumberedWalletAddr` after deploy

## 4. Relay Script

- [x] 4.1 Wrap Sapphire signer with `wrapEthersSigner`
- [x] 4.2 Update `ensureDeployed` — remove `depositAddress` param, pass `SEPOLIA_CHAIN_ID`
- [x] 4.3 Read `encumberedWalletAddr()` as deposit target
- [x] 4.4 Update `sendDeposit` to send to encumbered wallet address
- [x] 4.5 Implement `requestWithdrawal` — fetch gas price, deduct gas cost, call `withdraw()`, parse `WithdrawalSigned` event
- [x] 4.6 Implement `broadcastWithdrawal` — broadcast signed tx on Sepolia
- [x] 4.7 Add Steps 6-8 to main flow with round-trip balance display

## 5. Config & Docs

- [x] 5.1 Update `.env.example` — remove `DEPOSIT_ADDRESS`, add note about auto-generated deposit address
- [x] 5.2 Update README with withdrawal flow, encumbered wallet docs, updated architecture diagram, dependencies table

## 6. Verification

- [x] 6.1 `npx hardhat compile` — no errors
- [x] 6.2 `npx tsc --noEmit` — no new type errors (pre-existing error in test-edge-cases.ts unrelated)
