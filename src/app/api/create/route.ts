import { NextRequest, NextResponse } from 'next/server';
import { BASE_SEPOLIA, CASH_TOKEN, DEPLOYMENT } from '@/config/base-sepolia';

// Mock ITF creation data to simulate backend response
interface ITFData {
  id: string;
  name: string;
  description?: string;
  riskProfile: string;
  initialAmount: string;
  imageIpfsHash?: string;
  userAddress: string;
  timestamp: string;
}

// Store ITFs in memory for demo purposes
const itfs: ITFData[] = [];

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    // Validate required fields
    if (!data.name || !data.riskProfile || !data.initialAmount) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Create a new ITF entry
    const newItf: ITFData = {
      id: `itf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      name: data.name,
      description: data.description,
      riskProfile: data.riskProfile,
      initialAmount: data.initialAmount,
      imageIpfsHash: data.imageIpfsHash,
      userAddress: data.userAddress || '0xb067fB16AFcABf8A8974a35CbCee243B8FDF0EA1',
      timestamp: new Date().toISOString(),
    };
    
    // Add to our in-memory store
    itfs.push(newItf);
    
    // Log for debugging
    console.log('Created ITF:', newItf);
    
    // In a real implementation, you would:
    // 1. Call smart contract to create ITF
    // 2. Store metadata in IPFS or database
    // 3. Return transaction hash and ITF ID
    
    // Mock successful response
    return NextResponse.json({
      success: true,
      data: newItf,
      message: 'ITF created successfully',
    });
  } catch (error) {
    console.error('Error creating ITF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create ITF' },
      { status: 500 }
    );
  }
}

// GET handler to retrieve ITFs (for testing/debugging)
export async function GET() {
  try {
    // Return example ITF configurations
    const stocks = DEPLOYMENT.stocks.map((st) => st.testSymbol);
    const exampleConfigs = [
      {
        id: 'example_1',
        name: 'Magnificent 7',
        description: 'Equal-weight basket of Base tokenized mega-cap stocks',
        tokens: ['tAAPLc', 'tMSFTc', 'tNVDAc', 'tGOOGLc', 'tAMZNc', 'tMETAc', 'tTSLAc']
          .map((symbol) => ({ symbol, allocation: Math.round((100 / 7) * 100) / 100 })),
        rebalanceFrequency: 'weekly',
        riskLevel: 'medium',
        minInvestment: '100',
        maxInvestment: '10000'
      }
    ];

    return NextResponse.json({
      success: true,
      data: {
        examples: exampleConfigs,
        supportedTokens: [CASH_TOKEN.symbol, ...stocks],
        supportedChains: [{ id: String(BASE_SEPOLIA.chainId), name: BASE_SEPOLIA.name }]
      }
    });

  } catch (error) {
    console.error('❌ Error getting ITF configs:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to get ITF configurations'
    }, { status: 500 });
  }
}
