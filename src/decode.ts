import { AbiCoder, getAddress, Transaction } from "ethers";
import { ERC20_TRANSFER_SELECTOR } from "./constants.js";

export type DecodedTransfer = {
  selector: string;
  to: string;
  amountRaw: bigint;
};

export function decodeErc20TransferCalldata(data: string): DecodedTransfer | null {
  if (!data.startsWith(ERC20_TRANSFER_SELECTOR)) return null;
  const params = ("0x" + data.slice(10)) as `0x${string}`;
  const coder = AbiCoder.defaultAbiCoder();
  const [to, amount] = coder.decode(["address", "uint256"], params) as unknown as [
    string,
    bigint,
  ];
  return {
    selector: ERC20_TRANSFER_SELECTOR,
    to: getAddress(to),
    amountRaw: amount,
  };
}

export function decodeSignedTransaction(serialized: string): {
  to: string | null;
  data: string;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas?: bigint;
  gasPrice?: bigint;
  chainId: bigint;
  decoded: DecodedTransfer | null;
} {
  const tx = Transaction.from(serialized);
  const data = tx.data;
  return {
    to: tx.to,
    data,
    nonce: tx.nonce,
    gasLimit: tx.gasLimit,
    maxFeePerGas: tx.maxFeePerGas ?? undefined,
    gasPrice: tx.gasPrice ?? undefined,
    chainId: tx.chainId,
    decoded: decodeErc20TransferCalldata(data),
  };
}