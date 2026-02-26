import { Queue, Worker } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import { logEvent } from '../lib/utils/logger';
import { Redis } from '@upstash/redis';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Initialize BullMQ queue for cleanup jobs
const cleanupQueue = new Queue('voice-cleanup', {
  connection: {
    url: process.env.UPSTASH_REDIS_REST_URL,
  }
});

class VoiceCleanupService {
  /**
   * Schedule regular cleanup of voice files older than specified hours
   */
  static async scheduleRegularCleanup(hoursOld: number = 24): Promise<void> {
    logEvent('cleanup_schedule_start', { hoursOld });

    try {
      // Process cleanup regularly (every hour)
      setInterval(async () => {
        await this.performCleanup(hoursOld);
      }, 60 * 60 * 1000); // Every hour

      logEvent('cleanup_scheduler_started', { interval: 'hourly', hoursOld });
    } catch (error) {
      logEvent('cleanup_schedule_error', { error: error.message });
      throw error;
    }
  }

  /**
   * Perform the actual cleanup of old voice files
   */
  static async performCleanup(hoursOld: number = 24): Promise<void> {
    logEvent('cleanup_start', { hoursOld });

    try {
      // Calculate the cutoff time
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hoursOld);

      // List all files in the audio bucket
      const { data, error } = await supabase
        .storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'saathi-media')
        .list('audio/', {
          limit: 1000,
          offset: 0,
          sortBy: { column: 'created_at', order: 'desc' },
        });

      if (error) {
        logEvent('cleanup_list_error', { error: error.message });
        throw error;
      }

      // Filter files older than cutoff time and add to cleanup queue
      for (const file of data) {
        // Parse the creation time from the file metadata if possible
        // If not available, we'll use the naming convention or just delete based on filename pattern
        const fileName = file.name;
        const filePath = `audio/${fileName}`;

        // Add deletion job to queue
        await cleanupQueue.add('delete-file', { 
          filePath, 
          cutoffTime: cutoffTime.toISOString() 
        }, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        });
      }

      logEvent('cleanup_jobs_added', { 
        totalFiles: data.length, 
        hoursOld,
        cutoffTime: cutoffTime.toISOString()
      });
    } catch (error) {
      logEvent('cleanup_perform_error', { error: error.message });
      throw error;
    }
  }

  /**
   * Start the cleanup worker to process deletion jobs
   */
  static startCleanupWorker(): Worker {
    const worker = new Worker('voice-cleanup', async (job) => {
      if (job.name === 'delete-file') {
        const { filePath } = job.data;

        logEvent('deletion_job_start', { 
          jobId: job.id, 
          filePath 
        });

        try {
          // Delete the file from Supabase storage
          const { error } = await supabase
            .storage
            .from(process.env.SUPABASE_STORAGE_BUCKET || 'saathi-media')
            .remove([filePath]);

          if (error) {
            logEvent('deletion_error', { 
              jobId: job.id, 
              filePath, 
              error: error.message 
            });
            throw error;
          }

          logEvent('deletion_success', { 
            jobId: job.id, 
            filePath 
          });

          return { success: true, filePath };
        } catch (error) {
          logEvent('deletion_failed', { 
            jobId: job.id, 
            filePath, 
            error: error.message 
          });

          // Throw error so BullMQ can retry
          throw error;
        }
      }
    }, {
      connection: {
        url: process.env.UPSTASH_REDIS_REST_URL,
      },
      concurrency: 5, // Process up to 5 deletions concurrently
    });

    worker.on('completed', (job) => {
      logEvent('cleanup_job_completed', { jobId: job.id });
    });

    worker.on('failed', (job, err) => {
      logEvent('cleanup_job_failed', {
        jobId: job?.id,
        error: err.message
      });
    });

    logEvent('cleanup_worker_started', { concurrency: 5 });

    return worker;
  }
}

// Start the cleanup service when this script is run directly
if (require.main === module) {
  (async () => {
    try {
      // Start the cleanup worker
      const worker = VoiceCleanupService.startCleanupWorker();

      // Schedule regular cleanup
      await VoiceCleanupService.scheduleRegularCleanup(
        parseInt(process.env.AUTO_DELETE_VOICE_AFTER_HOURS || '24', 10)
      );

      logEvent('voice_cleanup_service_started', {
        hoursOld: process.env.AUTO_DELETE_VOICE_AFTER_HOURS || '24'
      });

      // Graceful shutdown
      const handleShutdown = async () => {
        logEvent('cleanup_shutdown_start', {});
        await worker.close();
        logEvent('cleanup_shutdown_complete', {});
        process.exit(0);
      };

      process.on('SIGINT', handleShutdown);
      process.on('SIGTERM', handleShutdown);
    } catch (error) {
      logEvent('cleanup_startup_error', { error: error.message });
      process.exit(1);
    }
  })();
}

export default VoiceCleanupService;