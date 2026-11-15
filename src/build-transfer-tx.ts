import { Contract, JsonRpcProvider, Transaction, Wallet, parseUnits } from "ethers";
import { TOKENS, type TokenSymbol } from "./constants.js";

const MINIMAL_ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;

export type BuildTransferParams = {
  token: TokenSymbol;
  amount: string;
  recipient: string;
  /** If unset, uses current pending nonce from RPC */
  nonce?: number;
  gasLimit?: bigint;
  /** Legacy tx gasPrice (wei). Use with type 0 txs on some demos */
  gasPriceWei?: bigint;
  maxFeePerGasWei?: bigint;
  maxPriorityFeePerGasWei?: bigint;
};

export type BuiltTransfer = {
  serialized: string;
  hash: string;
  tokenBalance: bigint;
  ethBalance: bigint;
  wouldRevertIfMined: boolean;
};

/**
 * Builds a signed ERC-20 transfer. Signing does NOT check token balance —
 * that is enforced only when the tx is executed on-chain.
 */
export async function buildSignedErc20Transfer(
  rpcUrl: string,
  privateKey: string,
  params: BuildTransferParams,
): Promise<BuiltTransfer> {
  const token = TOKENS[params.token];
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(token.address, MINIMAL_ERC20_ABI, wallet);

  const amountRaw = parseUnits(params.amount, token.decimals);
  const [tokenBalance, ethBalance, nonce] = await Promise.all([
    contract.balanceOf(wallet.address) as Promise<bigint>,
    provider.getBalance(wallet.address),
    params.nonce !== undefined ? Promise.resolve(params.nonce) : wallet.getNonce("pending"),
  ]);

  const populated = await contract.transfer.populateTransaction(params.recipient, amountRaw);
  const gasLimit = params.gasLimit ?? 65_000n;

  const txRequest: Record<string, unknown> = {
    ...populated,
    chainId: (await provider.getNetwork()).chainId,
    nonce,
    gasLimit,
  };

  if (params.gasPriceWei !== undefined) {
    txRequest.type = 0;
    txRequest.gasPrice = params.gasPriceWei;
  } else {
    txRequest.type = 2;
    const fee = await provider.getFeeData();
    txRequest.maxFeePerGas =
      params.maxFeePerGasWei ?? fee.maxFeePerGas ?? parseUnits("2", "gwei");
    txRequest.maxPriorityFeePerGas =
      params.maxPriorityFeePerGasWei ?? fee.maxPriorityFeePerGas ?? parseUnits("1", "gwei");
  }

  const signed = await wallet.signTransaction(txRequest);
  const serialized = signed.startsWith("0x") ? signed : `0x${signed}`;
  const txHash = Transaction.from(serialized).hash!;

  return {
    serialized,
    hash: txHash,
    tokenBalance,
    ethBalance,
    wouldRevertIfMined: tokenBalance < amountRaw,
  };
}