using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class FirebaseStorageDownloadService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly HttpClient _http = new();

    public string StampingImagesDirectory => WorkerDataPaths.StampingImagesDirectory;

    public Task<StampingImageDownload> DownloadStampingImageAsync(
        string jobId,
        string serialNumber,
        string downloadUrl,
        string fileName,
        string contentType,
        CancellationToken cancellationToken = default) =>
        DownloadVerificationImageAsync(
            jobId,
            serialNumber,
            downloadUrl,
            fileName,
            contentType,
            "stamping",
            "Serial number plate photo",
            cancellationToken);

    public Task<StampingImageDownload> DownloadScaleImageAsync(
        string jobId,
        string serialNumber,
        string downloadUrl,
        string fileName,
        string contentType,
        CancellationToken cancellationToken = default) =>
        DownloadVerificationImageAsync(
            jobId,
            serialNumber,
            downloadUrl,
            fileName,
            contentType,
            "scale",
            "Instrument photo",
            cancellationToken);

    public async Task<StampingImageDownload?> TryDownloadVerificationImageAsync(
        string jobId,
        string serialNumber,
        string downloadUrl,
        string fileName,
        string contentType,
        string imageKind,
        string imageLabel,
        CancellationToken cancellationToken = default,
        string? storagePath = null,
        string? idToken = null,
        string? storageBucket = null)
    {
        if (VerificationWeightPhotoResolver.LooksLikeHttp(downloadUrl))
        {
            try
            {
                return await DownloadVerificationImageAsync(
                    jobId,
                    serialNumber,
                    downloadUrl,
                    fileName,
                    contentType,
                    imageKind,
                    imageLabel,
                    cancellationToken);
            }
            catch (Exception)
            {
                // Expired token / 403 — try storage path with bearer.
            }
        }

        var path = FirstStoragePath(storagePath, StoragePathFromDownloadUrl(downloadUrl), downloadUrl);
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(idToken))
        {
            return null;
        }

        try
        {
            return await DownloadFromStoragePathAsync(
                jobId,
                serialNumber,
                path,
                fileName,
                contentType,
                imageKind,
                imageLabel,
                idToken,
                storageBucket,
                cancellationToken);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private async Task<StampingImageDownload> DownloadVerificationImageAsync(
        string jobId,
        string serialNumber,
        string downloadUrl,
        string fileName,
        string contentType,
        string imageKind,
        string imageLabel,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(downloadUrl))
        {
            throw new InvalidOperationException($"{imageLabel} download URL is missing.");
        }

        if (string.IsNullOrWhiteSpace(jobId))
        {
            throw new InvalidOperationException("Verification job id is missing.");
        }

        using var response = await _http.GetAsync(downloadUrl, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Could not download {imageLabel.ToLowerInvariant()} ({(int)response.StatusCode}).");
        }

        var extension = ResolveExtension(fileName, contentType);
        var safeSerial = SanitizePathSegment(serialNumber, "serial");
        var jobDirectory = Path.Combine(StampingImagesDirectory, SanitizePathSegment(jobId, "job"));
        Directory.CreateDirectory(jobDirectory);

        var localFileName = $"{safeSerial}-{imageKind}{extension}";
        var localPath = Path.Combine(jobDirectory, localFileName);

        await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
        await using (var output = File.Create(localPath))
        {
            await input.CopyToAsync(output, cancellationToken);
        }

        var fileInfo = new FileInfo(localPath);
        var download = new StampingImageDownload(
            localPath,
            jobDirectory,
            localFileName,
            fileInfo.Length,
            downloadUrl,
            jobId,
            serialNumber);

        await WriteManifestAsync(download, fileName, contentType, cancellationToken);
        return download;
    }

    private async Task<StampingImageDownload> DownloadFromStoragePathAsync(
        string jobId,
        string serialNumber,
        string storagePath,
        string fileName,
        string contentType,
        string imageKind,
        string imageLabel,
        string idToken,
        string? storageBucket,
        CancellationToken cancellationToken)
    {
        var bucket = string.IsNullOrWhiteSpace(storageBucket)
            ? "yesgatc.firebasestorage.app"
            : storageBucket.Trim();
        var url =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o/{Uri.EscapeDataString(storagePath)}?alt=media";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Could not download {imageLabel.ToLowerInvariant()} from storage ({(int)response.StatusCode}).");
        }

        var extension = ResolveExtension(fileName, contentType);
        var safeSerial = SanitizePathSegment(serialNumber, "serial");
        var jobDirectory = Path.Combine(StampingImagesDirectory, SanitizePathSegment(jobId, "job"));
        Directory.CreateDirectory(jobDirectory);
        var localFileName = $"{safeSerial}-{imageKind}{extension}";
        var localPath = Path.Combine(jobDirectory, localFileName);

        await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
        await using (var output = File.Create(localPath))
        {
            await input.CopyToAsync(output, cancellationToken);
        }

        var fileInfo = new FileInfo(localPath);
        var download = new StampingImageDownload(
            localPath,
            jobDirectory,
            localFileName,
            fileInfo.Length,
            url,
            jobId,
            serialNumber);
        await WriteManifestAsync(download, fileName, contentType, cancellationToken);
        return download;
    }

    private static string FirstStoragePath(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value)
                && !VerificationWeightPhotoResolver.LooksLikeHttp(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    internal static string? StoragePathFromDownloadUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)
            || !url.Contains("firebasestorage.googleapis.com", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        try
        {
            var match = System.Text.RegularExpressions.Regex.Match(url, @"/o/([^?]+)");
            if (!match.Success)
            {
                return null;
            }

            return Uri.UnescapeDataString(match.Groups[1].Value.Replace('+', ' '));
        }
        catch
        {
            return null;
        }
    }

    private static async Task WriteManifestAsync(
        StampingImageDownload download,
        string originalFileName,
        string contentType,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(download.Directory, "download-info.json");
        var manifest = new
        {
            jobId = download.JobId,
            serialNumber = download.SerialNumber,
            localPath = download.LocalPath,
            fileName = download.FileName,
            sizeBytes = download.SizeBytes,
            sourceUrl = download.SourceUrl,
            originalFileName,
            contentType,
            downloadedAt = DateTimeOffset.Now.ToString("O"),
        };

        await File.WriteAllTextAsync(
            manifestPath,
            JsonSerializer.Serialize(manifest, JsonOptions),
            cancellationToken);
    }

    private static string ResolveExtension(string fileName, string contentType)
    {
        var fromName = Path.GetExtension(fileName);
        if (!string.IsNullOrWhiteSpace(fromName))
        {
            return fromName;
        }

        return contentType.Trim().ToLowerInvariant() switch
        {
            "image/jpeg" or "image/jpg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".jpg",
        };
    }

    private static string SanitizePathSegment(string value, string fallback)
    {
        var trimmed = value.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return fallback;
        }

        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(trimmed.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? fallback : sanitized;
    }
}
