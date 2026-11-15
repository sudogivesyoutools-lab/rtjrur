#!/usr/bin/env node
import { formatUnits, parseUnits } from "ethers";
import { buildSignedErc20Transfer } from "./build-transfer-tx.js";
import { TOKENS, type TokenSymbol } from "./constants.js";
import { decodeSignedTransaction } from "./decode.js";

function usage(): never {
  console.log(`
erc20-pending-tx-edu — educational CLI

Commands:
  explain                    Print how "pending token flash" scams work
  sign   --rpc URL --key KEY --token USDT|USDC --amount N --to ADDR [--gas-price-gwei G]
  decode --tx 0xSIGNED_HEX
  broadcast --rpc URL --key KEY ... (testnet only unless EDU_MAINNET_DEMO=1)

Examples:
  npm run demo:explain
  npm run demo:sign -- --rpc https://ethereum-sepolia-rpc.publicnode.com \\
    --key $PRIVATE_KEY --token USDT --amount 50000 --to 0x... --gas-price-gwei 0.01
`);
  process.exit(1);
}

function explain(): void {
  console.log(`
=== How your screenshots work (educational) ===

1. ERC-20 transfers are just contract calls
   - Calldata: transfer(recipient, amount) on USDT/USDC.
   - You can SIGN this with any wallet; nodes do not check your token balance.

2. Explorers decode mempool transactions
   - Once broadcast, Etherscan shows "Pending" and parses calldata as
     "355 USDT" even though the sender has 0 USDT.

3. Ultra-low gas keeps them pending forever
   - Your sample uses ~0.0078 gwei — far below mainnet base fee (tens of gwei).
   - Validators ignore the tx; it sits in (some) mempools until dropped (~hours/days).
   - Max fee is tiny: gasLimit × gasPrice ≈ 65000 × 0.0078 gwei ≈ 0.0000005 ETH.

4. If it ever confirmed, it would REVERT
   - USDT transfer() requires balance >= amount; execution fails, no tokens move.
   - Scams rely on victims not knowing "pending ≠ received".

5. Nonce queue (your screenshot warning)
   - Multiple signed txs with nonces 0,1,2,... all at low gas stack as pending.
   - Explorers show many fake outgoing transfers from one dust ETH wallet.

6. Discord / "flash" bots
   - Typically: sign + broadcast low-gas ERC-20 transfer, post Etherscan link.
   - Wallets sometimes show optimistic pending credits — vendor-dependent bug/UX.

Defenses: only trust CONFIRMED transfers; verify token contract + balance on-chain;
ignore pending incoming tokens; never pay fees to "release" fake funds.

This repo signs/broadcasts for learning. Default policy: Sepolia testnet only.
`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = { _: "" };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = val;
        i++;
      }
    } else {
      rest.push(a);
    }
  }
  out._ = rest.join(" ");
  return out;
}

async function cmdSign(args: Record<string, string>): Promise<void> {
  const rpc = args.rpc;
  const key = args.key;
  const token = (args.token ?? "USDT").toUpperCase() as TokenSymbol;
  const amount = args.amount ?? "1";
  const to = args.to;
  if (!rpc || !key || !to) usage();

  const gasGwei = args["gas-price-gwei"];
  const gasPriceWei = gasGwei ? parseUnits(gasGwei, "gwei") : parseUnits("0.01", "gwei");

  const built = await buildSignedErc20Transfer(rpc, key, {
    token,
    amount,
    recipient: to,
    gasPriceWei,
    gasLimit: 65_000n,
  });

  const meta = decodeSignedTransaction(built.serialized);
  const dec = TOKENS[token];

  console.log(JSON.stringify({
    txHash: built.hash,
    serialized: built.serialized,
    fromTokenBalance: formatUnits(built.tokenBalance, dec.decimals),
    fromEthBalanceEth: formatUnits(built.ethBalance, 18),
    decodedAmount: meta.decoded ? formatUnits(meta.decoded.amountRaw, dec.decimals) : null,
    gasPriceGwei: meta.gasPrice ? formatUnits(meta.gasPrice, "gwei") : null,
    maxCostEth: meta.gasPrice
      ? formatUnits(meta.gasPrice * meta.gasLimit, 18)
      : null,
    wouldRevertIfMined: built.wouldRevertIfMined,
    note: built.wouldRevertIfMined
      ? "If mined, transfer reverts — explorers still show pending calldata before that."
      : "Sender has enough tokens; this would succeed if mined.",
  }, null, 2));
}

function cmdDecode(args: Record<string, string>): void {
  const tx = args.tx;
  if (!tx) usage();
  const meta = decodeSignedTransaction(tx.startsWith("0x") ? tx : `0x${tx}`);
  console.log(JSON.stringify(meta, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function cmdBroadcast(args: Record<string, string>): Promise<void> {
  const rpc = args.rpc ?? "";
  const isMainnet =
    rpc.includes("mainnet") ||
    rpc.includes("eth.llamarpc") ||
    args.network === "mainnet";
  if (isMainnet && process.env.EDU_MAINNET_DEMO !== "1") {
    console.error(
      "Refusing mainnet broadcast without EDU_MAINNET_DEMO=1. Use Sepolia for labs.",
    );
    process.exit(2);
  }

  const built = await buildSignedErc20Transfer(
    args.rpc!,
    args.key!,
    {
      token: (args.token ?? "USDT").toUpperCase() as TokenSymbol,
      amount: args.amount ?? "1",
      recipient: args.to!,
      gasPriceWei: parseUnits(args["gas-price-gwei"] ?? "0.01", "gwei"),
    },
  );

  const { JsonRpcProvider } = await import("ethers");
  const provider = new JsonRpcProvider(args.rpc);
  try {
    const hash = await provider.broadcastTransaction(built.serialized);
    console.log(JSON.stringify({ broadcast: true, hash: hash.hash }, null, 2));
  } catch (e) {
    console.log(
      JSON.stringify({
        broadcast: false,
        error: e instanceof Error ? e.message : String(e),
        hint: "Some RPCs reject underpriced txs before they hit public mempools.",
      }, null, 2),
    );
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (!cmd || cmd === "help" || cmd === "-h") usage();

switch (cmd) {
  case "explain":
    explain();
    break;
  case "sign":
    await cmdSign(args);
    break;
  case "decode":
    cmdDecode(args);
    break;
  case "broadcast":
    await cmdBroadcast(args);
    break;
  default:
    usage();
}