/**
 * YouTube API Service
 * Handles communication with backend YouTube endpoints
 */

// Backend API configuration
export const API_BASE_URL = process.env.BIBSCRIP_BASE_URL || 'http://localhost:4000';

const YOUTUBE_ENDPOINTS = {
  VIDEO: (videoId: string) => `${API_BASE_URL}/api/youtube/video/${videoId}`,
  CHANNEL: (channelId: string) => `${API_BASE_URL}/api/youtube/channel/${channelId}`,
  SEARCH: `${API_BASE_URL}/api/youtube`
};

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  thumbnail: {
    url: string;
    width: number;
    height: number;
  };
  channel: {
    id: string;
    title: string;
  };
  publishedAt: string;
  duration: string;
  viewCount: number;
  url: string;
  platform: 'youtube';
}

export interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  thumbnail: {
    url: string;
    width: number;
    height: number;
  };
  subscriberCount: number;
  videoCount: number;
  url: string;
}

export interface YouTubeSearchParams {
  query: string;
  maxResults?: number;
  order?: 'relevance' | 'date' | 'rating' | 'viewCount' | 'title';
  videoDuration?: 'any' | 'short' | 'medium' | 'long';
  type?: 'video' | 'channel' | 'playlist';
}

export interface YouTubeSearchResult {
  videos: YouTubeVideo[];
  channels?: YouTubeChannel[];
  totalResults: number;
  nextPageToken?: string;
}

class YouTubeService {
  private async makeRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`YouTube API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('YouTube API Error:', error);
      throw error;
    }
  }

  /**
   * Search YouTube for videos and channels
   */
  async search(params: YouTubeSearchParams): Promise<YouTubeSearchResult> {
    const searchParams = new URLSearchParams({
      q: params.query,
      maxResults: (params.maxResults || 10).toString(),
      order: params.order || 'relevance',
      type: params.type || 'video',
    });

    if (params.videoDuration) {
      searchParams.append('videoDuration', params.videoDuration);
    }

    const url = `${YOUTUBE_ENDPOINTS.SEARCH}?${searchParams.toString()}`;
    return this.makeRequest<YouTubeSearchResult>(url);
  }

  /**
   * Get detailed information about a specific video
   */
  async getVideo(videoId: string): Promise<YouTubeVideo> {
    const url = YOUTUBE_ENDPOINTS.VIDEO(videoId);
    return this.makeRequest<YouTubeVideo>(url);
  }

  /**
   * Get detailed information about a specific channel
   */
  async getChannel(channelId: string): Promise<YouTubeChannel> {
    const url = YOUTUBE_ENDPOINTS.CHANNEL(channelId);
    return this.makeRequest<YouTubeChannel>(url);
  }

  /**
   * Search for videos with specific parameters optimized for insights
   */
  async searchForInsights(query: string, maxResults: number = 5): Promise<YouTubeVideo[]> {
    try {
      const result = await this.search({
        query,
        maxResults,
        order: 'relevance',
        type: 'video',
        videoDuration: 'any'
      });

      return result.videos.map(video => ({
        ...video,
        url: `https://www.youtube.com/watch?v=${video.id}`
      }));
    } catch (error) {
      console.warn('YouTube search for insights failed:', error);
      // Return fallback search URL
      return [{
        id: 'fallback',
        title: `${query} - Search on YouTube`,
        description: `Search YouTube for: ${query}`,
        thumbnail: {
          url: '',
          width: 0,
          height: 0
        },
        channel: {
          id: '',
          title: 'YouTube'
        },
        publishedAt: new Date().toISOString(),
        duration: '',
        viewCount: 0,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        platform: 'youtube' as const
      }];
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  extractVideoId(url: string): string | null {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Extract channel ID from YouTube URL
   */
  extractChannelId(url: string): string | null {
    const regex = /youtube\.com\/(?:c\/|channel\/|user\/)?([a-zA-Z0-9_-]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Format duration from ISO 8601 to human readable
   */
  formatDuration(duration: string): string {
    if (!duration) return '';
    
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return duration;

    const hours = (match[1] || '').replace('H', '');
    const minutes = (match[2] || '').replace('M', '');
    const seconds = (match[3] || '').replace('S', '');

    let result = '';
    if (hours) result += `${hours}:`;
    if (minutes) result += `${minutes.padStart(2, '0')}:`;
    if (seconds) result += seconds.padStart(2, '0');

    return result || duration;
  }

  /**
   * Format view count to human readable
   */
  formatViewCount(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M views`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K views`;
    } else {
      return `${count} views`;
    }
  }
}

// Export singleton instance
export const youtubeService = new YouTubeService();
export default youtubeService;
