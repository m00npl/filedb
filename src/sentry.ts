import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.log('⚠️  Sentry DSN not configured, skipping Sentry initialization');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Profiling
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    integrations: [
      nodeProfilingIntegration(),
    ],

    // Release tracking
    release: process.env.npm_package_version || '1.0.0',

    // BeforeSend hook to filter/modify events
    beforeSend(event, hint) {
      // Filter out specific errors if needed
      const error = hint.originalException;

      if (error && typeof error === 'object' && 'message' in error) {
        const message = String(error.message);

        // Don't send Redis connection errors to Sentry (we handle them gracefully)
        if (message.includes('NOAUTH') || message.includes('Redis connection')) {
          return null;
        }
      }

      return event;
    },
  });

  console.log(`✅ Sentry initialized (environment: ${process.env.NODE_ENV || 'development'})`);
}

// Helper function to capture exceptions
export function captureException(error: Error | unknown, context?: Record<string, any>) {
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

// Helper function to capture messages
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info') {
  Sentry.captureMessage(message, level);
}

// Helper to add breadcrumb
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb) {
  Sentry.addBreadcrumb(breadcrumb);
}

export { Sentry };
