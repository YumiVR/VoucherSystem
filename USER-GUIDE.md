# User guide

## First-time setup

You need two computers: one **Issuer** and one **Redeemer**. Each needs a camera (or you can import a photo or screenshot of a barcode).

1. Start the application. Choose **Set up as Issuer** on one computer and **Set up as Redeemer** on the other.
2. Choose an administrator password (at least 10 characters). Write it down and keep it safe: it cannot be recovered.
3. The role cannot be changed later without an administrator reset.

### Pairing

1. On the **Issuer**, the screen shows a large barcode and a pairing reference. Leave it displayed.
2. On the **Redeemer**, scan that barcode with the USB barcode scanner. The Redeemer then shows **Part 1 of N** (N is usually 8).
3. On the Issuer, press **Next: capture the Redeemer's setup barcodes**.
4. On the Issuer, scan each part shown on the Redeemer with the Issuer's camera (choose a camera if there are several). Use **Previous** and **Next** on the Redeemer to move between parts. Order does not matter. Captured parts are ticked.
5. When every part is captured the Issuer says **Pairing complete**. On the Redeemer press **The Issuer has captured every part**.
6. On the Redeemer, go to **Administration, Overview** and set the **Global Voucher Expiry**. Vouchers cannot be redeemed until this is set.

Compare the key fingerprints under **Pairing** on both computers if you want to confirm they match each other.

## Issuing vouchers (Issuer)

1. Choose **Create Voucher**.
2. Enter the person's full name. The amount is £4.00. To use another amount, choose *Use a different amount (administrator)* and sign in.
3. Press **Create voucher**.
4. Choose **Save PDF** or **Print PDF** (opens the PDF in your PDF viewer; use its Print command). Choose **Create another voucher** to continue. The voucher is not kept after you leave the screen, so save or print it first.

Print at 100 percent (actual size), no scaling, at the best quality. If scanning is unreliable, an administrator can choose a larger layout (Administration, Branding).

## Redeeming vouchers (Redeemer)

1. Choose **Scan Voucher**. The screen says **Ready to scan**; just scan the voucher with the USB barcode scanner. No text box needs clicking. (Open *Use the camera instead* if you need the camera.)
2. A valid voucher shows **✔ VALID VOUCHER** with the name, amount, creation date and reference. Honour the amount, then press **Redeem**. Press **Cancel** to record nothing.
3. A large green screen confirms the redemption was recorded. Press **Scan next voucher**.

If the voucher is rejected you will see a red ✖ or amber ⚠ screen with a short reason:

| Message | Meaning |
| --- | --- |
| Already redeemed | This voucher was used before |
| Voucher expired | The global expiry has passed |
| Invalid rolling date code / Incorrect installation identifier | Not issued by the paired Issuer for this installation |
| Invalid digital signature / Voucher data has been altered | Forged or modified |
| Unable to decrypt / Wrong Redeemer computer | Not readable by this computer |
| Unsupported voucher version / Invalid voucher structure | Not a supported voucher |
| Corrupted or incomplete PDF417 | Rescan |
| Creation date is in the future | Check the clock |
| Redeemer clock integrity warning | The clock went backwards; ask an administrator |
| Database error | Nothing was recorded; ask an administrator |

Do not honour a rejected voucher.

## Redemption history (Redeemer)

**Redemption History** lists redeemed vouchers. Search by name or voucher ID and sort by redemption date. There are no money totals.

## Administration

Open **Administration** and sign in. The session ends after 5 minutes of inactivity or when you press **Lock administration**.

- **Overview**: global expiry (Redeemer), clock warning resolution, pairing state, key fingerprints and installation identifier.
- **Branding**: organisation name, logo, colours, footer text and voucher layout (wallet, A6, A5).
- **Scanner and printer**: choose a camera, run a scanner test, open a test page for the printer.
- **Audit events**: expiry changes, logins, rejections, backups and other events.
- **Backup and reset**: create or restore an encrypted backup, or reset the installation.

### Backups

Create a backup regularly, especially on the Redeemer, and keep the file and its password somewhere safe. Without the Redeemer key, existing vouchers cannot be decrypted. Without the redemption database, redeemed vouchers could be accepted again.

### Resetting

Reset deletes the keys, pairing, settings and redemption records on this computer. Vouchers issued for the old keys stop working, and both computers must be paired again. Create a backup first. You must type `RESET` and enter the administrator password.

## Keyboard use

Everything can be used with the keyboard. Press **Tab** to move, **Enter** or **Space** to activate. On setup parts, the **Left** and **Right** arrow keys change the part.
