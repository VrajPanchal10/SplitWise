import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';
import { router } from 'expo-router';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30s timeout accommodates Render cold starts
});

// Request interceptor to attach JWT token and set Content-Type
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Check if this is a FormData request (React Native polyfills FormData,
      // so instanceof may not work reliably - check for _parts or constructor name)
      const isFormData =
        config.data instanceof FormData ||
        (typeof FormData !== 'undefined' && config.data instanceof FormData) ||
        (config.data && typeof config.data === 'object' && '_parts' in config.data) ||
        (config.data && typeof config.data === 'object' && config.data.getParts) ||
        (config.data && config.data.constructor && config.data.constructor.name === 'FormData');

      if (isFormData) {
        // Let axios/RN auto-detect FormData and set multipart/form-data WITH boundary
        if (config.headers) {
          delete config.headers['Content-Type'];
        }
      } else {
        // For all other requests, use JSON
        config.headers['Content-Type'] = 'application/json';
      }
    } catch (error) {
      console.error('Error getting auth token:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 Unauthorized, network errors, and retries
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // Detect network-level failures (no HTTP response received from server)
    const isNetworkError =
      !error.response ||
      error.code === 'ERR_NETWORK' ||
      error.message === 'Network Error' ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED';

    if (isNetworkError && config) {
      // Retry up to 2 times (3 total attempts) with 1-second delay
      const retryCount = config.__retryCount || 0;
      if (retryCount < 2) {
        config.__retryCount = retryCount + 1;
        console.log(`[API] Retrying connection (attempt ${retryCount + 1}/3)... (${config.url || ''})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return apiClient(config);
      }

      // Safe logging (never logs passwords or tokens)
      console.error('[API] Network error - server unreachable after retries:', {
        url: config?.url,
        code: error.code,
        message: error.message,
      });

      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        error.userMessage =
          'Connection timed out. The server may be waking up (Render free tier spin-up). Please try again in a few moments.';
      } else {
        error.userMessage =
          "Can't reach the server. Please check your internet connection and ensure the backend service is running.";
      }
      return Promise.reject(error);
    }

    // Handle auth failures only for protected endpoints.
    // Auth endpoints (login/signup) can legitimately return 401/409 - those
    // are business errors that must surface inline on the auth screen, not
    // trigger a logout redirect loop.
    const requestUrl = config?.url || '';
    const isAuthEndpoint =
      requestUrl.includes('/auth/login') || requestUrl.includes('/auth/signup');

    if (
      (error.response?.status === 401 || error.response?.status === 403) &&
      !isAuthEndpoint
    ) {
      try {
        await AsyncStorage.removeItem('authToken');
        await AsyncStorage.removeItem('userData');
        // Notify AuthContext to clear memory state and redirect cleanly
        import('react-native').then(({ DeviceEventEmitter }) => {
          DeviceEventEmitter.emit('auth:logout');
        });
      } catch (err) {
        console.error('Error clearing auth token:', err);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
