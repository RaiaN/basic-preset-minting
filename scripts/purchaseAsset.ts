import { getDefaultProvider, Wallet } from 'ethers'; // ethers v5
import 'dotenv/config';

import { ImmutableRpcUrl } from '../lib/constants';

import { config, orderbook,  } from '@imtbl/sdk';

const PUBLISHABLE_API_KEY = process.env.PUBLISHABLE_API_KEY; // Replace with your Publishable Key from the Immutable Hub
const provider = getDefaultProvider(ImmutableRpcUrl.Testnet);

const NFT_COLLECTION_ADDRESS = '0x5e2cd90375bfbc64e0b52fedfd854c9ec8afe37a';

const TAKER_PRIVATE_KEY = process.env.TAKER_PRIVATE_KEY;
const TAKER_ADDRESS = process.env.TAKER_ADDRESS;

const listListings = async (client: orderbook.Orderbook) => {
  const listedOrders = await client.listListings({
    sellItemContractAddress: NFT_COLLECTION_ADDRESS,
    status: orderbook.OrderStatusName.ACTIVE,
    pageSize: 50,
  });

  for (const listing of listedOrders.result) {
    console.log('order id:', listing.id);
  }

  console.log('Listings: ' + String(listedOrders.result));
};

const getActiveListing = async (client: orderbook.Orderbook): Promise<string> => {
  const listedOrders = await client.listListings({
    sellItemContractAddress: NFT_COLLECTION_ADDRESS,
    status: orderbook.OrderStatusName.ACTIVE,
    pageSize: 50,
  });

  for (const listing of listedOrders.result) {
    console.log(listing.fees);
    return listing.id;
  }

  return "";

};

const fulfillERC721Listing = async (
  client: orderbook.Orderbook,
  signer: Wallet
): Promise<void> => {
  const fulfiller = await signer.getAddress();

  const listingId = await getActiveListing(client);

  const { actions, expiration, order } = await client.fulfillOrder(
    listingId,
    fulfiller,
    [{
      amount: '1',  // 2% protocol fee + 5% royalty fee?
      recipientAddress: TAKER_ADDRESS!, // Replace address with your own marketplace address
    }]
  );

  console.log(`Fulfilling listing ${order}, transaction expiry ${expiration}`);

  for (const action of actions) {
    if (action.type === orderbook.ActionType.TRANSACTION) {
      const builtTx = await action.buildTransaction();

      // The network has introduced a minimum gas price of 100 Gwei to protect it against SPAM traffic, ensure it can process transactions efficiently and remain cost-effective.
      // Transactions with a tip cap below 100 Gwei are rejected by the RPC. This limit ensures a standard for transaction costs. This also implies that the fee cap must be greater than or equal to 100 Gwei.
      const gasOverrides = {
        maxPriorityFeePerGas: 10e9, // 100 Gwei
        maxFeePerGas: 15e9,
        gasLimit: 400000, // Set an appropriate gas limit for your transaction
      };

      const txWithGasOverrides = {
        ...builtTx,
        ...gasOverrides
      };

      console.log(`Submitting ${action.purpose} transaction`);
      await signer.sendTransaction(txWithGasOverrides);
    }
  }
};

const client = new orderbook.Orderbook({
  baseConfig: {
    environment: config.Environment.SANDBOX,
    publishableKey: PUBLISHABLE_API_KEY,
  },
});
console.log('Orderbook Client: ', client);

listListings(client);

// The wallet of the intended signer of the mint request
const signer = new Wallet(TAKER_PRIVATE_KEY!, provider);

// The wallet of the intended signer of the taker!
// const signer = new Wallet(TAKER_PRIVATE_KEY!, provider);

fulfillERC721Listing(client, signer).then(
  (response)=>{
    console.log('Listing existing orders for NFT');
    listListings(client);
  }
);