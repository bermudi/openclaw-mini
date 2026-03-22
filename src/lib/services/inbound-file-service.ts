// OpenClaw Agent Runtime - Inbound File Service
// Centralized management for inbound file downloads from channels

import * as path from 'path';
import * as fs from 'fs';
import type { ChannelType } from '@/lib/types';

/**
 * Service for managing inbound file downloads from channels.
 * Files are stored in data/sandbox/_inbound/{channel}/downloads/
 */
class InboundFileService {
  /**
   * Get the downloads directory for a specific channel type.
   * Creates the directory if it doesn't exist.
   * Returns the absolute path to data/sandbox/_inbound/{channelType}/downloads/
   */
  getDownloadsDir(channelType: ChannelType | string): string {
    const downloadsDir = path.join('data', 'sandbox', '_inbound', channelType, 'downloads');
    
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    
    return downloadsDir;
  }

  /**
   * Get the inbound directory for a specific channel type (without downloads subfolder).
   * Returns the absolute path to data/sandbox/_inbound/{channelType}/
   */
  getInboundDir(channelType: ChannelType | string): string {
    const inboundDir = path.join('data', 'sandbox', '_inbound', channelType);
    
    if (!fs.existsSync(inboundDir)) {
      fs.mkdirSync(inboundDir, { recursive: true });
    }
    
    return inboundDir;
  }
}

export const inboundFileService = new InboundFileService();
