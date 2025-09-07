# Polkadot Validator Statistics Tool

A powerful command-line tool for analyzing validator block production statistics on Polkadot and other Substrate-based networks. This tool uses the Polkadot.js SDK to query blockchain data and provides comprehensive statistics about validator performance over specified block ranges.

## 🌟 Features

- **Flexible Block Range Queries**: Query specific block ranges or from a start block to the latest block
- **Multiple Output Formats**: Support for table, JSON, and CSV output formats
- **Batch Processing**: Configurable batch size for efficient large-range queries
- **Real-time Progress**: Live progress indicator during data collection
- **Data Filtering & Sorting**: Filter by minimum block count and sort by different criteria
- **File Export**: Save results to files for further analysis
- **Network Flexibility**: Support for any Substrate-based network
- **Verbose Logging**: Detailed logging for debugging and monitoring

## 📋 Prerequisites

- Node.js (v14.0 or higher)
- npm or yarn package manager

## 🚀 Installation

1. **Clone or download the script files**

2. **Install dependencies**:
```bash
npm install
```

3. **Make the script executable** (optional):
```bash
chmod +x validator-stats.js
```

## 📖 Usage

### Basic Syntax
```bash
node validator-stats.js -s <start-block> [options]
```

### Required Parameters
- `-s, --start-block <number>`: Starting block number for analysis

### Optional Parameters

| Parameter | Alias | Type | Default | Description |
|-----------|-------|------|---------|-------------|
| `--end-block` | `-e` | number | latest | Ending block number |
| `--endpoint` | `-u` | string | wss://rpc.polkadot.io | WebSocket RPC endpoint |
| `--output` | `-o` | string | table | Output format (table/json/csv) |
| `--batch-size` | `-b` | number | 100 | Batch query size |
| `--save-to` | `-f` | string | - | Save results to file |
| `--verbose` | `-v` | boolean | false | Enable verbose output |
| `--include-empty` | - | boolean | false | Include validators with zero blocks |
| `--sort-by` | - | string | blocks | Sort by blocks or validator name |
| `--min-blocks` | - | number | 0 | Minimum block count filter |
| `--help` | `-h` | - | - | Show help information |

## 🔧 Examples

### Basic Usage
```bash
# Query validator stats from block 1000 to 2000
node validator-stats.js -s 1000 -e 2000

# Query from block 1000 to the latest block
node validator-stats.js -s 1000
```

### Output Formats
```bash
# JSON format output
node validator-stats.js -s 1000 -e 2000 -o json

# CSV format with file export
node validator-stats.js -s 1000 -e 2000 -o csv -f validators.csv

# Save JSON results to file
node validator-stats.js -s 1000 -e 2000 -o json -f results.json
```

### Network-Specific Queries
```bash
# Query Kusama network
node validator-stats.js -s 1000 -e 2000 -u wss://kusama-rpc.polkadot.io

# Query Westend testnet
node validator-stats.js -s 1000 -e 2000 -u wss://westend-rpc.polkadot.io
```

### Advanced Filtering and Sorting
```bash
# Filter validators with at least 10 blocks
node validator-stats.js -s 1000 -e 2000 --min-blocks 10

# Sort by validator name instead of block count
node validator-stats.js -s 1000 -e 2000 --sort-by validator

# Include validators with zero blocks produced
node validator-stats.js -s 1000 -e 2000 --include-empty
```

### Performance Optimization
```bash
# Use smaller batch size for limited resources
node validator-stats.js -s 1000 -e 2000 -b 50

# Use larger batch size for faster processing
node validator-stats.js -s 1000 -e 2000 -b 200

# Enable verbose logging for monitoring
node validator-stats.js -s 1000 -e 2000 -v
```

## 📊 Output Formats

### Table Format (Default)
```
📊 Validator Block Production Statistics:
================================================================================
Validator                                           Blocks      Share
--------------------------------------------------------------------------------
1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x...       150      15.00%
2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y...       120      12.00%
--------------------------------------------------------------------------------
Total: 50 validators, 1000 blocks
```

### JSON Format
```json
{
  "1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x": {
    "blockCount": 150
  },
  "2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y": {
    "blockCount": 120
  }
}
```

### CSV Format
```csv
Validator,Block Count,Percentage
"1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x",150,15.00%
"2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y",120,12.00%
```

## 🌐 Supported Networks

The tool supports any Substrate-based blockchain network. Common endpoints include:

| Network | WebSocket Endpoint |
|---------|-------------------|
| Polkadot | `wss://rpc.polkadot.io` |
| Kusama | `wss://kusama-rpc.polkadot.io` |
| Westend | `wss://westend-rpc.polkadot.io` |

## ⚡ Performance Tips

1. **Batch Size**: 
   - Smaller batches (50-100) for stable connections
   - Larger batches (200-500) for faster processing with good network conditions

2. **Block Range**: 
   - Large ranges may take significant time
   - Consider breaking very large ranges into smaller chunks

3. **Network Selection**: 
   - Use geographically closer RPC endpoints for better performance
   - Consider using archive nodes for historical data

## 🛠️ Troubleshooting

### Common Issues

**Connection Errors**
```bash
# Try alternative endpoints if default fails
node validator-stats.js -s 1000 -e 2000 -u wss://polkadot.api.onfinality.io/public-ws
```

**Memory Issues with Large Ranges**
```bash
# Reduce batch size for large ranges
node validator-stats.js -s 1000 -e 10000 -b 50
```

**Timeout Issues**
```bash
# Enable verbose logging to monitor progress
node validator-stats.js -s 1000 -e 2000 -v
```

### Debug Mode
Enable verbose logging to see detailed execution information:
```bash
node validator-stats.js -s 1000 -e 2000 -v
```

## 📁 Project Structure

```
polkadot-validator-stats/
├── validator-stats.js    # Main script file
├── package.json         # Node.js dependencies and configuration
└── README.md           # This file
```

## 🔧 Configuration

### Environment Variables
You can set default values using environment variables:
```bash
export POLKADOT_ENDPOINT="wss://your-preferred-endpoint"
export DEFAULT_BATCH_SIZE=150
```

### Custom RPC Endpoints
The tool works with any Substrate-based network. Simply provide the WebSocket RPC endpoint:
```bash
node validator-stats.js -s 1000 -e 2000 -u wss://your-custom-network.com
```

## 🤝 Contributing

Contributions are welcome! Here are some ways you can help:

1. **Report Bugs**: Open an issue with details about the problem
2. **Feature Requests**: Suggest new features or improvements
3. **Code Contributions**: Submit pull requests with bug fixes or new features
4. **Documentation**: Help improve documentation and examples

### Development Setup
```bash
# Clone the repository
git clone <repository-url>
cd polkadot-validator-stats

# Install dependencies
npm install

# Run in development mode
npm start -- -s 1000 -e 2000
```

## 📝 License

This project is licensed under the MIT License. See the LICENSE file for details.

## 🙏 Acknowledgments

- Built with [Polkadot.js API](https://polkadot.js.org/docs/api/)
- Command-line interface powered by [yargs](https://yargs.js.org/)
- Inspired by the Polkadot and Substrate ecosystems

## 📞 Support

If you encounter any issues or have questions:

1. Check the [Troubleshooting](#-troubleshooting) section
2. Review existing issues in the project repository
3. Create a new issue with detailed information about your problem
4. Join the Polkadot community discussions for general questions

---

**Happy analyzing! 🚀**
