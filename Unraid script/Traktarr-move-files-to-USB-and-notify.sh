#!/bin/bash
PATH=/usr/local/sbin:/usr/sbin:/sbin:/usr/local/bin:/usr/bin:/bin
## Version 1.0
## Script to be used with unRAID plugin "unassigned devices" that triggers on plugin/unplug of USB drive
## Example to install/update unassigned devices script from unraid cli, where script was initially installed as "Traktarr-move-files-to-USB-and-notify.sh"
## wget --no-check-certificate -O /boot/config/plugins/unassigned.devices/Traktarr-move-files-to-USB-and-notify.sh --content-disposition https://github.com/jorgenjanssonlee/traktarr-sync-files-from-lists/raw/main/Unraid%20script/Traktarr-move-files-to-USB-and-notify.sh

# Set the host path to sync FROM, e.g. the output folder of traktarr
unraidSourceFolder="/mnt/user/traktarroutputfolder/"
# Set a folder on the USB drive to sync TO, the folder will be created if it doesn't exist already
destFolder="from_traktarr"

## Available variables from unassigned devices:
# AVAIL      : available space
# USED       : used space
# SIZE       : partition size
# SERIAL     : disk serial number
# ACTION     : if mounting, ADD; if unmounting, REMOVE
# MOUNTPOINT : where the partition is mounted
# FSTYPE     : partition filesystem
# LABEL      : partition label
# DEVICE     : partition device, e.g /dev/sda1
# OWNER      : "udev" if executed by UDEV, otherwise "user"
# PROG_NAME  : program name of this script
# LOGFILE    : log file for this script



case $ACTION in
  'ADD' )
    if [ -d $MOUNTPOINT ]
    then
      if [ $OWNER = "udev" ]
      then
        logger Started -t$PROG_NAME
        echo "Started: `date`" > $LOGFILE
        sourcefiles=$(ls "$unraidSourceFolder")

	# --------- Start of moving files from unRAID to USB ------------
	logger Moving unRAID content to USB -t$PROG_NAME
  # move current files (symlinks) to a tempdir to allow clean deletion after processing is complete
  # NOTE: rsync --remove-source-files does NOT work on symlinks with the -L flag, it will resolve the symlink and delete the actual source files
  cd "$unraidSourceFolder"
  mkdir tempdir
  ls | grep -v tempdir | xargs mv -t tempdir
  # sync actual files (resolve symlinks) to USB folder
  rsync -rvL ./tempdir/ "$MOUNTPOINT"/"$destFolder" 2>&1 >> $LOGFILE
  # remove tempdir and the symlinks in it
  rm -rf ./tempdir

	logger Syncing -t$PROG_NAME
        sync

  logger Unmounting -t$PROG_NAME
        /usr/local/sbin/rc.unassigned umount $DEVICE

	logger Completed moving unRAID content to USB -t$PROG_NAME
        echo "Completed: `date`" >> $LOGFILE

  /usr/local/emhttp/webGui/scripts/notify -e "unRAID Server Notice" -s "Files from unRAID" -d "$sourcefiles" -i "normal"
	# --------- End of moving files from unRAID to USB ------------
    fi
    else
        logger Something went wrong -t$PROG_NAME
        /usr/local/emhttp/webGui/scripts/notify -e "unRAID Server Notice" -s "USB transfer error" -d "$(cat "$LOGFILE")" -i "normal"
    fi
  ;;

  'REMOVE' )
    # do your stuff here
    echo "Removed"
  ;;
esac
