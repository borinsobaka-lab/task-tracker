package com.borinsobaka.tasktracker;

import android.content.Intent;
import android.widget.RemoteViewsService;

public class TimelineWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new TimelineRemoteViewsFactory(getApplicationContext());
    }
}
