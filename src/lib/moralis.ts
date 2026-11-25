import Moralis from 'moralis';

// Initialize Moralis
export const initializeMoralis = async () => {
  if (!Moralis.Core.isStarted) {
    await Moralis.start({
      apiKey: process.env.NEXT_PUBLIC_MORALIS_API_KEY,
    });
  }
};

// Moralis configuration
export const moralisConfig = {
  apiKey: process.env.NEXT_PUBLIC_MORALIS_API_KEY,
  // Base-only app: Base Sepolia (0x14a34)
  chains: ['0x14a34'],
};

export default Moralis; 