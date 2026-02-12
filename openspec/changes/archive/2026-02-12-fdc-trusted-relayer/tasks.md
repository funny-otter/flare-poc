## 1. Solidity Contract Setup

- [x] 1.1 Scaffold `fdc-trusted-relayer/contracts/` with Hardhat (hardhat.config.ts, package.json, tsconfig)
- [x] 1.2 Install Hardhat dependencies (`hardhat`, `@nomicfoundation/hardhat-toolbox`, `@oasisprotocol/sapphire-hardhat`)
- [x] 1.3 Write `contracts/FdcAccounting.sol` per the sapphire-accounting spec (creditDeposit, getBalance, getBalanceOf, onlyRelayer, double-credit prevention, zero-value rejection)
- [x] 1.4 Compile the contract and verify clean build with `npx hardhat compile`

## 2. Relayer TypeScript Setup

- [x] 2.1 Add `@oasisprotocol/sapphire-paratime` dependency to root package.json
- [x] 2.2 Create `fdc-trusted-relayer/src/accounting-demo.ts` with provider initialization (Coston2 standard provider, Sapphire wrapped provider)
- [x] 2.3 Add contract ABI/bytecode import from Hardhat artifacts into the TypeScript relayer

## 3. Contract Deployment Logic

- [x] 3.1 Implement deploy-or-connect logic: deploy `FdcAccounting` if no address in env, otherwise attach to existing
- [x] 3.2 Set `authorizedRelayer` to the signer's address on fresh deploy

## 4. FDC Attestation & Verification

- [x] 4.1 Implement (or import from poc.ts) the FDC attestation flow: prepare request, submit to Coston2, wait for proof
- [x] 4.2 Implement on-chain proof verification via `FdcVerification` view call on Coston2
- [x] 4.3 Abort relay if proof verification returns false

## 5. Relay to Sapphire

- [x] 5.1 Extract `sourceAddress`, `value`, and `transactionHash` from verified proof response body
- [x] 5.2 Call `creditDeposit(txHash, depositor, value)` on the Sapphire accounting contract
- [x] 5.3 Query and log the depositor's balance via `getBalanceOf` after crediting

## 6. Configuration & Wiring

- [x] 6.1 Update `.env.example` with new vars: `SAPPHIRE_RPC`, `SAPPHIRE_PK`, `ACCOUNTING_CONTRACT_ADDRESS` (optional)
- [x] 6.2 Add npm script to run the accounting demo (`npm run accounting-demo` or similar)
- [x] 6.3 Verify full end-to-end flow: deploy → attest → verify → credit → query balance
