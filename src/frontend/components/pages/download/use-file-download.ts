import { TFile } from "@/shared/types/file"

export const useFileDownload = () => {
    const downloadFile = async (
        file: TFile,
        passhphrase: string,
        onDownloadReady: (blob: Blob) => void,
        onProgress?: ({ loaded, total }: { loaded: number, total: number }) => void,
        onDecodingStarted?: () => void
    ) => {
        const response = await fetch(`/api/v1/file/${file.uuid}/download`)
        const reader = response.body.getReader();
        let receivedLength = 0;

        const fileBuffer = new Uint8Array(file.bytesEncoded);

        let eof = false;
        while (!eof) {
            const {done, value} = await reader.read();
            eof = done;
            if (!done) {
                // chunks.push(value);
                fileBuffer.set(value, receivedLength);
                receivedLength += value.length;
                if (onProgress)
                    onProgress({ loaded: receivedLength, total: file.bytesEncoded });
            }
        }

        if (fileBuffer.length !== receivedLength)
            throw new Error(`Download file seems to be corrupt: file size does not correspond`);

        if (onDecodingStarted)
            onDecodingStarted();

        let cipherBytes = fileBuffer;
        const pbkdf2Iterations = 10000;
        const passphraseBytes = new TextEncoder().encode(passhphrase);
        const pbkdf2Salt = fileBuffer.slice(8, 16);

        const passphraseKey = await window.crypto.subtle.importKey('raw', passphraseBytes, {name: 'PBKDF2'}, false, ['deriveBits']);
        const pbkdf2Bytes = new Uint8Array(await window.crypto.subtle.deriveBits({name: 'PBKDF2', salt: pbkdf2Salt, iterations: pbkdf2Iterations, hash: 'SHA-256'}, passphraseKey, 384));


        const keyBytes = pbkdf2Bytes.slice(0, 32);
        const ivBytes = pbkdf2Bytes.slice(32);
        cipherBytes = cipherBytes.slice(16);

        const key = await window.crypto.subtle.importKey('raw', keyBytes, {name: 'AES-CBC', length: 256}, false, ['decrypt']);
        let plaintextBytes: ArrayBuffer;
        
        try {
            plaintextBytes = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes}, key, cipherBytes);
            if (!plaintextBytes) throw new Error();
        } catch {
            throw new Error(`Wrong passphrase`);
        }
        
        const blob = new Blob([plaintextBytes], {type: file.mime});
        onDownloadReady(blob);
    };

    return { downloadFile };
}